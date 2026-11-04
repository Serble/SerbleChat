// RTP for Discord voice: transport encryption (aead_aes256_gcm_rtpsize), parsing, and turning video
// packets back into whole frames (H264 per RFC 6184, VP8 per RFC 7741).

const crypto = require('crypto');

const TAG_LENGTH = 16;
const NONCE_LENGTH = 4;
const ENCRYPTION_MODE = 'aead_aes256_gcm_rtpsize';

function gcmNonce(counter4) {
  const nonce = Buffer.alloc(12);
  counter4.copy(nonce, 0, 0, 4);
  return nonce;
}

/** Encrypts an RTP (or RTCP, with an 8-byte header) packet. `header` is sent in the clear as associated data. */
function encrypt(key, header, payload, counter) {
  const counter4 = Buffer.alloc(4);
  counter4.writeUInt32BE(counter >>> 0, 0);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, gcmNonce(counter4));
  cipher.setAAD(header);
  return Buffer.concat([header, cipher.update(payload), cipher.final(), cipher.getAuthTag(), counter4]);
}

/**
 * Parses and decrypts an incoming RTP packet. Returns null for anything that isn't one we can read.
 * @returns {{ ssrc, seq, timestamp, marker, payloadType, payload: Buffer } | null}
 */
function decryptRtp(key, msg) {
  if (msg.length < 12 + TAG_LENGTH + NONCE_LENGTH) return null;
  if (msg[0] >> 6 !== 2) return null;
  // RTCP (sender/receiver reports, feedback): payload types 200-207 sit where RTP's marker+type byte is
  if (msg[1] >= 200 && msg[1] <= 207) return null;
  const csrcCount = msg[0] & 0x0f;
  const hasExtension = (msg[0] & 0x10) !== 0;
  const hasPadding = (msg[0] & 0x20) !== 0;
  let headerLength = 12 + csrcCount * 4;
  let extensionWords = 0;
  if (hasExtension) {
    if (msg.length < headerLength + 4) return null;
    extensionWords = msg.readUInt16BE(headerLength + 2);
    // With "rtpsize" modes only the extension's 4-byte header is in the clear; its body is encrypted
    headerLength += 4;
  }
  const end = msg.length - NONCE_LENGTH - TAG_LENGTH;
  if (end < headerLength) return null;
  let payload;
  try {
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, gcmNonce(msg.subarray(msg.length - NONCE_LENGTH)));
    decipher.setAAD(msg.subarray(0, headerLength));
    decipher.setAuthTag(msg.subarray(end, end + TAG_LENGTH));
    payload = Buffer.concat([decipher.update(msg.subarray(headerLength, end)), decipher.final()]);
  } catch {
    return null;
  }
  if (extensionWords) payload = payload.subarray(extensionWords * 4);
  if (hasPadding && payload.length) {
    const padding = payload[payload.length - 1];
    payload = padding <= payload.length ? payload.subarray(0, payload.length - padding) : Buffer.alloc(0);
  }
  return {
    ssrc: msg.readUInt32BE(8),
    seq: msg.readUInt16BE(2),
    timestamp: msg.readUInt32BE(4),
    marker: (msg[1] & 0x80) !== 0,
    payloadType: msg[1] & 0x7f,
    payload,
  };
}

/** An RTP header for an Opus packet. */
function opusHeader(seq, timestamp, ssrc) {
  const header = Buffer.alloc(12);
  header[0] = 0x80;
  header[1] = 120;
  header.writeUInt16BE(seq & 0xffff, 2);
  header.writeUInt32BE(timestamp >>> 0, 4);
  header.writeUInt32BE(ssrc >>> 0, 8);
  return header;
}

/** An RTCP picture loss indication: asks the sender of `mediaSsrc` for a keyframe. */
function pliPacket(key, senderSsrc, mediaSsrc, counter) {
  const header = Buffer.alloc(8);
  header[0] = 0x81; // version 2, FMT 1 (PLI)
  header[1] = 206; // payload-specific feedback
  header.writeUInt16BE(2, 2);
  header.writeUInt32BE(senderSsrc >>> 0, 4);
  const body = Buffer.alloc(4);
  body.writeUInt32BE(mediaSsrc >>> 0, 0);
  return encrypt(key, header, body, counter);
}

// ── Video depacketizers ──

const START_CODE = Buffer.from([0, 0, 0, 1]);

/** One H264 RTP payload -> { parts: Buffer[] (Annex B), keyframe }. */
function depacketizeH264(payload) {
  if (!payload.length) return { parts: [], keyframe: false };
  const type = payload[0] & 0x1f;
  if (type >= 1 && type <= 23) {
    return { parts: [START_CODE, payload], keyframe: type === 5 || type === 7 };
  }
  if (type === 24) { // STAP-A
    const parts = [];
    let keyframe = false;
    let offset = 1;
    while (offset + 2 <= payload.length) {
      const size = payload.readUInt16BE(offset);
      offset += 2;
      if (!size || offset + size > payload.length) break;
      const nal = payload.subarray(offset, offset + size);
      const nalType = nal[0] & 0x1f;
      if (nalType === 5 || nalType === 7) keyframe = true;
      parts.push(START_CODE, nal);
      offset += size;
    }
    return { parts, keyframe };
  }
  if (type === 28) { // FU-A
    if (payload.length < 2) return { parts: [], keyframe: false };
    const start = (payload[1] & 0x80) !== 0;
    const nalType = payload[1] & 0x1f;
    const body = payload.subarray(2);
    if (!start) return { parts: [body], keyframe: false };
    const nalHeader = Buffer.from([(payload[0] & 0xe0) | nalType]);
    return { parts: [START_CODE, nalHeader, body], keyframe: nalType === 5 || nalType === 7 };
  }
  return { parts: [], keyframe: false };
}

/** One VP8 RTP payload -> { parts, keyframe, start }. */
function depacketizeVP8(payload) {
  if (!payload.length) return { parts: [], keyframe: false, start: false };
  let offset = 1;
  const extended = (payload[0] & 0x80) !== 0;
  const startOfPartition = (payload[0] & 0x10) !== 0;
  const partitionId = payload[0] & 0x07;
  if (extended) {
    const x = payload[1];
    offset = 2;
    if (x & 0x80) offset += (payload[offset] & 0x80) ? 2 : 1; // PictureID
    if (x & 0x40) offset += 1; // TL0PICIDX
    if (x & 0x30) offset += 1; // TID / KEYIDX
  }
  const body = payload.subarray(offset);
  const start = startOfPartition && partitionId === 0;
  // The first byte of a VP8 frame: bit 0 clear means a keyframe (it stays unencrypted with DAVE)
  const keyframe = start && body.length > 0 && (body[0] & 0x01) === 0;
  return { parts: [body], keyframe, start };
}

const seqNewer = (a, b) => ((a - b) & 0xffff) !== 0 && ((a - b) & 0xffff) < 0x8000;
const seqDiff = (a, b) => ((a - b) << 16) >> 16; // a - b, wrapped to -32768..32767

/** An RTCP generic NACK: asks the sender of `mediaSsrc` to resend these sequence numbers. */
function nackPacket(key, senderSsrc, mediaSsrc, seqs, counter) {
  const items = [];
  const sorted = [...seqs].sort((a, b) => seqDiff(a, b));
  while (sorted.length) {
    const pid = sorted.shift();
    let blp = 0;
    while (sorted.length && seqDiff(sorted[0], pid) >= 1 && seqDiff(sorted[0], pid) <= 16) blp |= 1 << (seqDiff(sorted.shift(), pid) - 1);
    items.push([pid, blp]);
  }
  const header = Buffer.alloc(8);
  header[0] = 0x81; // version 2, FMT 1 (generic NACK)
  header[1] = 205; // transport feedback
  header.writeUInt16BE(2 + items.length, 2);
  header.writeUInt32BE(senderSsrc >>> 0, 4);
  const body = Buffer.alloc(4 + items.length * 4);
  body.writeUInt32BE(mediaSsrc >>> 0, 0);
  items.forEach(([pid, blp], i) => { body.writeUInt16BE(pid & 0xffff, 4 + i * 4); body.writeUInt16BE(blp, 6 + i * 4); });
  return encrypt(key, header, body, counter);
}

// How long to wait for a missing packet (resent after a NACK) before giving up on its frame
const LOSS_TIMEOUT_MS = 250;

/**
 * Collects one sender's video packets and puts out whole frames, in order. Missing packets are asked
 * for again (`onNack`); if they still haven't come after LOSS_TIMEOUT_MS, the frames they belong to are
 * dropped, output carries on from the next frame that starts cleanly, and `onLoss` asks for a keyframe.
 * Padding-only packets (bandwidth probes) just fill their sequence numbers.
 */
class FrameAssembler {
  constructor(codec, onFrame, onLoss, onNack) {
    this.codec = codec;
    this.onFrame = onFrame;
    this.onLoss = onLoss;
    this.onNack = onNack;
    /** seq -> { timestamp, marker, payload } */
    this.packets = new Map();
    this.next = null; // the next sequence number to put out
    this.highest = null;
    this.stuckSince = 0;
    this.discontinuity = true;
    this.nacked = new Map(); // seq -> times asked
  }

  push(packet) {
    const { seq } = packet;
    if (this.next !== null && seqNewer(this.next, seq)) return; // already past it
    if (this.packets.has(seq)) return;
    this.packets.set(seq, packet);
    if (this.highest === null || seqNewer(seq, this.highest)) {
      // A jump: ask again for what's in between
      if (this.highest !== null && this.next !== null) {
        const missing = [];
        for (let s = (this.highest + 1) & 0xffff; s !== seq && missing.length < 64; s = (s + 1) & 0xffff) missing.push(s);
        if (missing.length) this.nack(missing);
      }
      this.highest = seq;
    }
    if (this.next === null) {
      // Joining partway through: start at the frame after the first one we see end
      if (!packet.marker) return;
      this.next = (seq + 1) & 0xffff;
      for (const s of [...this.packets.keys()]) if (!seqNewer(s, seq)) this.packets.delete(s);
      return;
    }
    this.drain();
    if (this.packets.size > 3000) this.skip(); // something's badly wrong; start over
  }

  nack(seqs) {
    const ask = seqs.filter(s => (this.nacked.get(s) ?? 0) < 2);
    for (const s of ask) this.nacked.set(s, (this.nacked.get(s) ?? 0) + 1);
    if (this.nacked.size > 512) this.nacked.delete(this.nacked.keys().next().value);
    if (ask.length) this.onNack(ask);
  }

  /** Puts out every frame that's complete from `next` on. */
  drain() {
    for (;;) {
      const seqs = [];
      let s = this.next;
      let timestamp = null;
      let complete = false;
      while (seqs.length < 2000) {
        const p = this.packets.get(s);
        if (!p) break;
        if (!p.payload.length && !p.marker) { // padding: skip over it
          if (!seqs.length) { this.packets.delete(s); this.next = (s + 1) & 0xffff; }
          else seqs.push(s);
          s = (s + 1) & 0xffff;
          continue;
        }
        if (timestamp === null) timestamp = p.timestamp;
        else if (p.timestamp !== timestamp) break;
        seqs.push(s);
        if (p.marker) { complete = true; break; }
        s = (s + 1) & 0xffff;
      }
      if (complete) {
        this.emit(seqs, timestamp);
        this.stuckSince = 0;
        continue;
      }
      // Waiting on a packet (the one at `s`)
      this.stuckAt = s;
      const now = Date.now();
      if (!this.stuckSince) {
        this.stuckSince = now;
        const missing = this.packets.has(s) ? null : s;
        if (missing !== null && this.highest !== null && seqNewer(this.highest, missing)) this.nack([missing]);
      } else if (now - this.stuckSince > LOSS_TIMEOUT_MS) {
        this.skip();
        if (this.next === null) return;
        continue;
      }
      return;
    }
  }

  emit(seqs, timestamp) {
    const parts = [];
    let keyframe = false;
    for (const seq of seqs) {
      const p = this.packets.get(seq);
      this.packets.delete(seq);
      if (!p.payload.length) continue;
      const out = this.codec === 'VP8' ? depacketizeVP8(p.payload) : depacketizeH264(p.payload);
      if (out.keyframe) keyframe = true;
      parts.push(...out.parts);
    }
    this.next = (seqs[seqs.length - 1] + 1) & 0xffff;
    const data = Buffer.concat(parts);
    if (!data.length) return;
    // After a loss, frames until the next keyframe refer to something we never got
    this.onFrame({ data, keyframe, timestamp, discontinuity: this.discontinuity });
    this.discontinuity = false;
  }

  /** Gives up on what's missing: carries on from the next frame that starts after it. */
  skip() {
    this.stuckSince = 0;
    this.discontinuity = true;
    this.onLoss();
    const after = this.stuckAt ?? this.next;
    const seqs = [...this.packets.keys()].filter(s => seqNewer(s, after)).sort((a, b) => seqDiff(a, b));
    for (const s of seqs) {
      const p = this.packets.get(s);
      const prev = this.packets.get((s - 1) & 0xffff);
      const starts = (prev && (prev.marker || prev.timestamp !== p.timestamp)) || (this.codec === 'VP8' && p.payload.length && depacketizeVP8(p.payload).start);
      if (starts && p.payload.length) {
        for (const old of [...this.packets.keys()]) if (seqNewer(s, old)) this.packets.delete(old);
        this.next = s;
        return;
      }
    }
    // Nothing usable yet: wait for the next frame end and start after it
    this.packets.clear();
    this.next = null;
  }
}

module.exports = { ENCRYPTION_MODE, encrypt, decryptRtp, opusHeader, pliPacket, nackPacket, depacketizeH264, depacketizeVP8, FrameAssembler, seqNewer };
