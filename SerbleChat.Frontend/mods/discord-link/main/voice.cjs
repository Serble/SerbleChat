// One connection to a Discord voice server: a voice channel, or a Go Live stream you're watching
// (which is its own connection). Voice gateway v8 over a WebSocket, media over UDP (RTP with
// aead_aes256_gcm_rtpsize transport encryption and DAVE end-to-end encryption).

const { EventEmitter } = require('events');
const dgram = require('dgram');
const net = require('net');
const WebSocket = require('ws');
const { DaveSession, MediaType } = require('./dave.cjs');
const { ENCRYPTION_MODE, encrypt, decryptRtp, opusHeader, pliPacket, nackPacket, FrameAssembler } = require('./rtp.cjs');

const Op = {
  IDENTIFY: 0, SELECT_PROTOCOL: 1, READY: 2, HEARTBEAT: 3, SESSION_DESCRIPTION: 4, SPEAKING: 5,
  HEARTBEAT_ACK: 6, RESUME: 7, HELLO: 8, RESUMED: 9, CLIENTS_CONNECT: 11, VIDEO: 12,
  CLIENT_DISCONNECT: 13, MEDIA_SINK_WANTS: 15,
  DAVE_PREPARE_TRANSITION: 21, DAVE_EXECUTE_TRANSITION: 22, DAVE_TRANSITION_READY: 23,
  DAVE_PREPARE_EPOCH: 24, MLS_EXTERNAL_SENDER: 25, MLS_KEY_PACKAGE: 26, MLS_PROPOSALS: 27,
  MLS_COMMIT_WELCOME: 28, MLS_ANNOUNCE_COMMIT_TRANSITION: 29, MLS_WELCOME: 30, MLS_INVALID_COMMIT_WELCOME: 31,
};

// What we can take. We never send video, so only decoding matters. (Payload types are our choice.)
const CODECS = [
  { name: 'opus', type: 'audio', priority: 1000, payload_type: 120 },
  { name: 'H264', type: 'video', priority: 1000, payload_type: 101, rtx_payload_type: 102, encode: false, decode: true },
  { name: 'VP8', type: 'video', priority: 2000, payload_type: 105, rtx_payload_type: 106, encode: false, decode: true },
];
const VIDEO_PAYLOAD_TYPES = new Map([[101, 'H264'], [105, 'VP8']]);
const RTX_PAYLOAD_TYPES = new Set([102, 106]);
const SILENCE = Buffer.from([0xf8, 0xff, 0xfe]);
const FRAME_SAMPLES = 960; // 20 ms at 48 kHz

class VoiceConnection extends EventEmitter {
  /**
   * @param {object} options
   * @param {'voice' | 'stream'} options.kind
   * @param {string} options.daveChannelId The DAVE group: the channel ID, or for a stream its rtc_server_id - 1
   */
  constructor({ endpoint, serverId, userId, sessionId, token, daveChannelId, kind, log }) {
    super();
    Object.assign(this, { endpoint, serverId, userId, sessionId, token, daveChannelId, kind, log });
    this.status = 'connecting';
    this.closed = false;
    this.seqAck = -1;
    this.ssrc = 0;
    this.key = null;
    this.rtpSeq = Math.floor(Math.random() * 0xffff);
    this.nonce = 0;
    this.lastTimestamp = null;
    this.speaking = false;
    this.dave = null;
    this.videoCodec = null;
    this.connected = new Set();
    /** ssrc -> userId */
    this.audioSsrcs = new Map();
    /** ssrc -> { userId, assembler } */
    this.videoSsrcs = new Map();
    /** retransmission ssrc -> the video ssrc it resends for */
    this.rtxSsrcs = new Map();
    this.videoStats = { frames: 0, keyframes: 0, losses: 0, nacks: 0, resent: 0 };
    this.lastPli = new Map();
    this.udp = null;
    this.remote = null;
    this.connectWs(false);
  }

  // ── Voice gateway ──

  connectWs(resume) {
    const host = this.endpoint.replace(/^wss:\/\//, '').replace(/\/$/, '');
    const scheme = process.env.DISCORD_LINK_VOICE_SCHEME ?? 'wss'; // overridable for testing
    const ws = new WebSocket(`${scheme}://${host}/?v=8`);
    this.ws = ws;
    ws.on('open', () => {
      if (resume) {
        this.send(Op.RESUME, { server_id: this.serverId, session_id: this.sessionId, token: this.token, seq_ack: this.seqAck });
      } else {
        this.send(Op.IDENTIFY, {
          server_id: this.serverId,
          user_id: this.userId,
          session_id: this.sessionId,
          token: this.token,
          video: true,
          streams: [{ type: this.kind === 'stream' ? 'screen' : 'video', rid: '100', quality: 100 }],
          max_dave_protocol_version: DaveSession.maxProtocolVersion,
        });
      }
    });
    ws.on('message', (data, isBinary) => {
      try {
        if (isBinary) this.onBinary(Buffer.from(data));
        else this.onPacket(JSON.parse(data.toString()));
      } catch (err) {
        this.log.error(`[${this.kind}] voice packet handling failed:`, err);
      }
    });
    ws.on('close', (code, reason) => this.onWsClose(ws, code, String(reason)));
    ws.on('error', (err) => this.log.warn(`[${this.kind}] voice socket error:`, err.message));
  }

  send(op, d) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify({ op, d }));
  }

  sendBinary(op, payload) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(Buffer.concat([Buffer.from([op]), payload]));
  }

  onWsClose(ws, code, reason) {
    if (ws !== this.ws) return;
    clearInterval(this.heartbeatTimer);
    if (this.closed) return;
    const resumable = code === 4015 || code < 4000;
    if (resumable && this.status === 'ready') {
      this.log.warn(`[${this.kind}] voice socket closed (${code}); resuming`);
      this.connectWs(true);
      return;
    }
    this.log.warn(`[${this.kind}] voice connection closed (${code}${reason ? `: ${reason}` : ''})`);
    this.destroy();
    this.emit('close', code, reason);
  }

  onPacket({ op, d, seq }) {
    if (seq != null) this.seqAck = seq;
    switch (op) {
      case Op.HELLO:
        clearInterval(this.heartbeatTimer);
        this.heartbeatTimer = setInterval(() => this.send(Op.HEARTBEAT, { t: Date.now(), seq_ack: this.seqAck }), d.heartbeat_interval);
        break;
      case Op.READY:
        this.onReady(d).catch(err => {
          this.log.error(`[${this.kind}] couldn't set up the media connection:`, err);
          this.fail(err.message);
        });
        break;
      case Op.SESSION_DESCRIPTION:
        this.onSessionDescription(d);
        break;
      case Op.RESUMED:
        this.speaking = false;
        break;
      case Op.SPEAKING:
        if (d.user_id && d.ssrc) this.audioSsrcs.set(d.ssrc, d.user_id);
        this.emit('speaking', d.user_id, d.speaking);
        break;
      case Op.CLIENTS_CONNECT:
        for (const id of d.user_ids ?? []) this.connected.add(id);
        this.emit('clients');
        break;
      case Op.CLIENT_DISCONNECT:
        this.connected.delete(d.user_id);
        for (const [ssrc, id] of this.audioSsrcs) if (id === d.user_id) this.audioSsrcs.delete(ssrc);
        for (const [ssrc, v] of this.videoSsrcs) if (v.userId === d.user_id) this.videoSsrcs.delete(ssrc);
        this.emit('clients');
        this.emit('videoEnd', d.user_id);
        break;
      case Op.VIDEO:
        this.onVideo(d);
        break;
      case Op.DAVE_PREPARE_TRANSITION:
        if (this.dave?.prepareTransition(d)) this.send(Op.DAVE_TRANSITION_READY, { transition_id: d.transition_id });
        break;
      case Op.DAVE_EXECUTE_TRANSITION:
        this.dave?.executeTransition(d.transition_id);
        break;
      case Op.DAVE_PREPARE_EPOCH:
        this.dave?.prepareEpoch(d);
        break;
    }
  }

  onBinary(buffer) {
    this.seqAck = buffer.readUInt16BE(0);
    const op = buffer.readUInt8(2);
    const payload = buffer.subarray(3);
    if (!this.dave) return;
    switch (op) {
      case Op.MLS_EXTERNAL_SENDER:
        this.dave.setExternalSender(payload);
        break;
      case Op.MLS_PROPOSALS: {
        const reply = this.dave.processProposals(payload, this.connected);
        if (reply) this.sendBinary(Op.MLS_COMMIT_WELCOME, reply);
        break;
      }
      case Op.MLS_ANNOUNCE_COMMIT_TRANSITION:
      case Op.MLS_WELCOME: {
        const { transitionId, success } = op === Op.MLS_WELCOME ? this.dave.processWelcome(payload, this.connected) : this.dave.processCommit(payload);
        if (success && transitionId !== 0) this.send(Op.DAVE_TRANSITION_READY, { transition_id: transitionId });
        if (success) this.emit('privacy');
        break;
      }
    }
  }

  async onReady({ ssrc, ip, port, modes }) {
    this.ssrc = ssrc;
    this.remote = { ip, port };
    if (!modes.includes(ENCRYPTION_MODE)) throw new Error(`Discord didn't offer ${ENCRYPTION_MODE} (offered ${modes.join(', ')})`);
    const udp = dgram.createSocket('udp4');
    this.udp = udp;
    udp.on('error', err => this.log.warn(`[${this.kind}] UDP error:`, err.message));
    const local = await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('IP discovery timed out')), 10000);
      const onMessage = (msg) => {
        if (msg.length !== 74 || msg.readUInt16BE(0) !== 2) return;
        clearTimeout(timeout);
        udp.off('message', onMessage);
        const address = msg.subarray(8, msg.indexOf(0, 8)).toString('utf8');
        if (!net.isIPv4(address)) return reject(new Error('Bad IP discovery reply'));
        resolve({ address, port: msg.readUInt16BE(72) });
      };
      udp.on('message', onMessage);
      const packet = Buffer.alloc(74);
      packet.writeUInt16BE(1, 0);
      packet.writeUInt16BE(70, 2);
      packet.writeUInt32BE(ssrc, 4);
      udp.send(packet, port, ip);
    });
    udp.on('message', msg => this.onUdp(msg));
    // Keeps the NAT mapping open
    let keepAlive = 0;
    this.keepAliveTimer = setInterval(() => {
      const b = Buffer.alloc(8);
      b.writeUInt32LE(keepAlive++ >>> 0, 0);
      this.udpSend(b);
    }, 5000);
    this.send(Op.SELECT_PROTOCOL, { protocol: 'udp', data: { address: local.address, port: local.port, mode: ENCRYPTION_MODE }, codecs: CODECS });
    // We don't send video
    this.send(Op.VIDEO, { audio_ssrc: ssrc, video_ssrc: 0, rtx_ssrc: 0, streams: [] });
  }

  onSessionDescription(d) {
    this.key = Buffer.from(d.secret_key);
    this.videoCodec = d.video_codec ?? null;
    if (d.dave_protocol_version > 0 || this.dave) {
      if (!this.dave) {
        this.dave = new DaveSession(d.dave_protocol_version, this.userId, this.daveChannelId, this.log);
        this.dave.on('keyPackage', kp => this.sendBinary(Op.MLS_KEY_PACKAGE, kp));
        this.dave.on('invalidateTransition', id => this.send(Op.MLS_INVALID_COMMIT_WELCOME, { transition_id: id }));
        this.dave.on('transitioned', () => this.emit('privacy'));
      }
      this.dave.protocolVersion = d.dave_protocol_version;
      this.dave.reinit();
    }
    if (this.kind === 'stream') this.send(Op.MEDIA_SINK_WANTS, { any: 100 });
    this.status = 'ready';
    this.emit('ready');
  }

  onVideo(d) {
    const userId = d.user_id;
    if (!userId) return;
    if (d.audio_ssrc) this.audioSsrcs.set(d.audio_ssrc, userId);
    const ssrcs = new Set();
    if (d.video_ssrc) ssrcs.add(d.video_ssrc);
    if (d.video_ssrc && d.rtx_ssrc) this.rtxSsrcs.set(d.rtx_ssrc, d.video_ssrc);
    for (const s of d.streams ?? []) {
      if (!s.ssrc || s.active === false) continue;
      ssrcs.add(s.ssrc);
      if (s.rtx_ssrc) this.rtxSsrcs.set(s.rtx_ssrc, s.ssrc);
    }
    // Keep the ones that carry on (and their half-built frames)
    for (const [ssrc, v] of this.videoSsrcs) if (v.userId === userId && !ssrcs.has(ssrc)) this.videoSsrcs.delete(ssrc);
    for (const ssrc of ssrcs) if (!this.videoSsrcs.has(ssrc)) this.videoSsrcs.set(ssrc, { userId, assembler: null });
    if (!ssrcs.size) this.emit('videoEnd', userId);
  }

  // ── Media ──

  udpSend(buffer) {
    if (this.udp && this.remote) this.udp.send(buffer, this.remote.port, this.remote.ip);
  }

  onUdp(msg) {
    if (!this.key) return;
    const packet = decryptRtp(this.key, msg);
    if (!packet) return;
    const audioUser = this.audioSsrcs.get(packet.ssrc);
    if (audioUser && packet.payloadType === 120) {
      let opus = packet.payload;
      if (this.dave) opus = this.dave.decrypt(audioUser, MediaType.AUDIO, opus);
      if (opus) this.emit('audio', audioUser, packet.timestamp, opus);
      return;
    }
    // A resent packet: its first two bytes are the original sequence number
    const rtxFor = this.rtxSsrcs.get(packet.ssrc);
    if (rtxFor !== undefined || RTX_PAYLOAD_TYPES.has(packet.payloadType)) {
      const original = this.videoSsrcs.get(rtxFor ?? packet.ssrc);
      if (!original?.assembler || packet.payload.length < 2) return;
      this.videoStats.resent++;
      original.assembler.push({ ...packet, ssrc: rtxFor, seq: packet.payload.readUInt16BE(0), payload: packet.payload.subarray(2) });
      return;
    }
    const video = this.videoSsrcs.get(packet.ssrc);
    if (!video) return;
    const codec = VIDEO_PAYLOAD_TYPES.get(packet.payloadType) ?? this.videoCodec;
    if (codec !== 'H264' && codec !== 'VP8') return;
    if (!video.assembler || video.assembler.codec !== codec) {
      const ssrc = packet.ssrc;
      video.assembler = new FrameAssembler(codec,
        frame => this.onVideoFrame(video.userId, codec, frame, ssrc),
        () => { this.videoStats.losses++; this.requestKeyframe(ssrc); },
        seqs => { this.videoStats.nacks += seqs.length; this.udpSend(nackPacket(this.key, this.ssrc, ssrc, seqs, this.nextNonce())); });
      // Joining partway through a stream: start from a keyframe
      this.requestKeyframe(ssrc);
    }
    video.assembler.push(packet);
  }

  onVideoFrame(userId, codec, frame, ssrc) {
    this.videoStats.frames++;
    if (frame.keyframe) this.videoStats.keyframes++;
    let data = frame.data;
    if (this.dave) {
      data = this.dave.decrypt(userId, MediaType.VIDEO, data);
      if (!data) {
        this.requestKeyframe(ssrc);
        return;
      }
    }
    this.emit('video', userId, { codec, data, keyframe: frame.keyframe, timestamp: frame.timestamp, discontinuity: frame.discontinuity });
  }

  /** Asks a video sender for a keyframe (at most once a second). */
  requestKeyframe(ssrc) {
    if (!this.key || !ssrc) return;
    const now = Date.now();
    if (now - (this.lastPli.get(ssrc) ?? 0) < 1000) return;
    this.lastPli.set(ssrc, now);
    this.udpSend(pliPacket(this.key, this.ssrc, ssrc, this.nextNonce()));
  }

  requestKeyframeFor(userId) {
    for (const [ssrc, v] of this.videoSsrcs) if (v.userId === userId) this.requestKeyframe(ssrc);
  }

  nextNonce() {
    this.nonce = (this.nonce + 1) >>> 0;
    return this.nonce;
  }

  setSpeaking(speaking) {
    if (this.status !== 'ready' || this.speaking === speaking) return;
    this.speaking = speaking;
    this.send(Op.SPEAKING, { speaking: speaking ? 1 : 0, delay: 0, ssrc: this.ssrc });
  }

  /** Sends one Opus packet (20 ms) with the given RTP timestamp (48 kHz). */
  sendOpus(opus, timestamp) {
    if (this.status !== 'ready' || !this.key) return;
    this.setSpeaking(true);
    const payload = this.dave ? this.dave.encryptOpus(opus) : opus;
    if (!payload) return;
    this.rtpSeq = (this.rtpSeq + 1) & 0xffff;
    this.lastTimestamp = timestamp >>> 0;
    this.udpSend(encrypt(this.key, opusHeader(this.rtpSeq, this.lastTimestamp, this.ssrc), payload, this.nextNonce()));
  }

  /** Ends a burst of speech: five silence frames (so receivers don't interpolate), then not speaking. */
  stopSpeaking() {
    if (!this.speaking) return;
    let ts = this.lastTimestamp ?? 0;
    for (let i = 0; i < 5; i++) {
      ts = (ts + FRAME_SAMPLES) >>> 0;
      this.sendOpus(SILENCE, ts);
    }
    this.setSpeaking(false);
  }

  get privacyCode() {
    return this.dave?.privacyCode ?? null;
  }

  fail(message) {
    if (this.closed) return;
    this.destroy();
    this.emit('close', 0, message);
  }

  destroy() {
    if (this.closed) return;
    this.closed = true;
    this.status = 'closed';
    clearInterval(this.heartbeatTimer);
    clearInterval(this.keepAliveTimer);
    try { this.ws?.close(1000); } catch { /* gone */ }
    try { this.udp?.close(); } catch { /* gone */ }
    this.dave?.destroy();
  }
}

module.exports = { VoiceConnection };
