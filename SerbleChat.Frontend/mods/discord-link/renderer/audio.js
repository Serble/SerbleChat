// Audio for the Discord side of a call, at 48 kHz:
//  - capture: the Serble mic track -> 20 ms frames -> voice activity check -> Opus (WebCodecs) -> main half
//  - playback: Opus from each Discord user -> decoded (WebCodecs) -> a jitter buffer per user -> mixed out

const SAMPLE_RATE = 48000;
const FRAME = 960; // 20 ms
const SILENCE = [0xf8, 0xff, 0xfe];

// Runs on the audio thread. Each voice (a Discord user, or a stream's sound) has a ring buffer that
// packets are written into at their RTP timestamp, played out a fixed delay behind.
const WORKLETS = `
const RING = ${SAMPLE_RATE} * 2;
const DELAY = 2880; // 60 ms of jitter buffer

class DiscordLinkPlayer extends AudioWorkletProcessor {
  constructor() {
    super();
    this.voices = new Map();
    this.pos = 0;
    this.blocks = 0;
    this.port.onmessage = ({ data: m }) => {
      if (m.type === 'pcm') this.write(m);
      else if (m.type === 'gain') this.voice(m.key).gain = m.gain;
      else if (m.type === 'remove') this.voices.delete(m.key);
    };
  }
  voice(key) {
    let v = this.voices.get(key);
    if (!v) {
      v = { l: new Float32Array(RING), r: new Float32Array(RING), anchorTs: null, anchorPos: 0, end: 0, gain: 1, level: 0, late: 0 };
      this.voices.set(key, v);
    }
    return v;
  }
  write({ key, ts, l, r }) {
    const v = this.voice(key);
    const n = l.length;
    let target = v.anchorTs === null ? 0 : v.anchorPos + (ts - v.anchorTs);
    // Start of a burst of speech (or the first packet): play it DELAY from now
    const reanchor = v.anchorTs === null || v.end <= this.pos || target > this.pos + DELAY * 6 || target + n > this.pos + RING - 256;
    if (reanchor) {
      v.anchorTs = ts;
      v.anchorPos = this.pos + DELAY;
      target = v.anchorPos;
      v.late = 0;
    } else if (target < this.pos) {
      // Too late to play. A few in a row means the delay's too short for this connection: start over
      if (++v.late > 4) v.anchorTs = null;
      return;
    }
    for (let i = 0; i < n; i++) {
      const j = (target + i) % RING;
      v.l[j] = l[i];
      v.r[j] = r[i];
    }
    v.end = Math.max(v.end, target + n);
  }
  process(_inputs, outputs) {
    const L = outputs[0][0];
    const R = outputs[0][1] ?? L;
    const n = L.length;
    for (const v of this.voices.values()) {
      if (v.end <= this.pos) { v.level = 0; continue; }
      let energy = 0;
      for (let i = 0; i < n; i++) {
        const j = (this.pos + i) % RING;
        const a = v.l[j], b = v.r[j];
        v.l[j] = 0; v.r[j] = 0;
        energy += a * a + b * b;
        L[i] += a * v.gain;
        if (R !== L) R[i] += b * v.gain;
      }
      v.level = Math.max(v.level * 0.85, Math.sqrt(energy / (2 * n)));
    }
    this.pos += n;
    if (++this.blocks % 8 === 0) {
      const levels = {};
      for (const [key, v] of this.voices) levels[key] = v.end > this.pos ? v.level : 0;
      this.port.postMessage({ type: 'levels', levels });
    }
    return true;
  }
}
registerProcessor('discord-link-player', DiscordLinkPlayer);

// Cuts the mic into 20 ms stereo frames
class DiscordLinkCapture extends AudioWorkletProcessor {
  constructor() {
    super();
    this.l = new Float32Array(${FRAME});
    this.r = new Float32Array(${FRAME});
    this.n = 0;
    this.frame = 0;
  }
  process(inputs) {
    const input = inputs[0];
    if (!input || !input.length) return true;
    const a = input[0], b = input[1] ?? input[0];
    for (let i = 0; i < a.length; i++) {
      this.l[this.n] = a[i];
      this.r[this.n] = b[i];
      if (++this.n === ${FRAME}) {
        this.port.postMessage({ l: this.l, r: this.r, frame: this.frame++ }, [this.l.buffer, this.r.buffer]);
        this.l = new Float32Array(${FRAME});
        this.r = new Float32Array(${FRAME});
        this.n = 0;
      }
    }
    return true;
  }
}
registerProcessor('discord-link-capture', DiscordLinkCapture);
`;

export class AudioEngine {
  constructor({ gainFor, onLevels, log }) {
    this.gainFor = gainFor;
    this.onLevels = onLevels;
    this.log = log;
    this.ctx = null;
    this.ready = null;
    /** key -> { decoder, lastRaw, unwrapped } */
    this.decoders = new Map();
    this.gains = new Map();
    this.capture = null;
  }

  init() {
    this.ready ??= (async () => {
      this.ctx = new AudioContext({ sampleRate: SAMPLE_RATE, latencyHint: 'interactive' });
      const url = URL.createObjectURL(new Blob([WORKLETS], { type: 'text/javascript' }));
      try {
        await this.ctx.audioWorklet.addModule(url);
      } finally {
        URL.revokeObjectURL(url);
      }
      this.player = new AudioWorkletNode(this.ctx, 'discord-link-player', { numberOfInputs: 0, outputChannelCount: [2] });
      this.master = this.ctx.createGain();
      this.player.connect(this.master).connect(this.ctx.destination);
      this.player.port.onmessage = ({ data }) => { if (data.type === 'levels') this.onLevels(data.levels); };
      if (this.ctx.state === 'suspended') await this.ctx.resume().catch(() => {});
    })();
    return this.ready;
  }

  async setOutputDevice(deviceId) {
    await this.init();
    if (typeof this.ctx.setSinkId !== 'function') return;
    try {
      await this.ctx.setSinkId(!deviceId || deviceId === 'default' ? '' : deviceId);
    } catch (err) {
      this.log.warn('Could not use the chosen output device for Discord audio:', err.message);
    }
  }

  setMaster(gain) {
    if (this.master) this.master.gain.value = gain;
  }

  setGain(key, gain) {
    if (this.gains.get(key) === gain) return;
    this.gains.set(key, gain);
    this.player?.port.postMessage({ type: 'gain', key, gain });
  }

  /** One Opus packet from `key` (a Discord user ID, or "stream:<key>") with its RTP timestamp. */
  push(key, rtpTimestamp, opus) {
    if (!this.player) return;
    let d = this.decoders.get(key);
    if (!d) {
      d = this.createDecoder(key);
      if (!d) return;
      this.decoders.set(key, d);
      this.setGain(key, this.gainFor(key));
    }
    // Unwrap the 32-bit timestamp so it keeps counting up
    if (d.lastRaw === null) d.unwrapped = 0;
    else d.unwrapped += (rtpTimestamp - d.lastRaw) | 0;
    d.lastRaw = rtpTimestamp;
    if (opus.length === 3 && opus[0] === SILENCE[0] && opus[1] === SILENCE[1] && opus[2] === SILENCE[2]) return;
    if (d.decoder.state !== 'configured') return;
    try {
      d.decoder.decode(new EncodedAudioChunk({ type: 'key', timestamp: Math.round(d.unwrapped * 1e6 / SAMPLE_RATE), data: opus }));
    } catch (err) {
      this.log.warn(`Opus decode failed for ${key}:`, err.message);
    }
  }

  createDecoder(key) {
    const d = { decoder: null, lastRaw: null, unwrapped: 0 };
    const make = () => {
      d.decoder = new AudioDecoder({
        output: (data) => this.onDecoded(key, data),
        error: (err) => {
          this.log.warn(`Opus decoder for ${key} failed (${err.message}); starting a new one`);
          setTimeout(make, 100);
        },
      });
      d.decoder.configure({ codec: 'opus', sampleRate: SAMPLE_RATE, numberOfChannels: 2 });
    };
    try {
      make();
    } catch (err) {
      this.log.error('This build of Electron can\'t decode Opus with WebCodecs:', err);
      return null;
    }
    return d;
  }

  onDecoded(key, data) {
    try {
      const frames = data.numberOfFrames;
      const l = new Float32Array(frames);
      const r = new Float32Array(frames);
      data.copyTo(l, { planeIndex: 0, format: 'f32-planar' });
      if (data.numberOfChannels > 1) data.copyTo(r, { planeIndex: 1, format: 'f32-planar' });
      else r.set(l);
      const ts = Math.round(data.timestamp * SAMPLE_RATE / 1e6);
      this.player.port.postMessage({ type: 'pcm', key, ts, l, r }, [l.buffer, r.buffer]);
    } finally {
      data.close();
    }
  }

  /** Forgets a voice (someone left). */
  remove(key) {
    const d = this.decoders.get(key);
    if (d) {
      try { d.decoder.close(); } catch { /* already closed */ }
      this.decoders.delete(key);
    }
    this.gains.delete(key);
    this.player?.port.postMessage({ type: 'remove', key });
  }

  // ── The mic ──

  /**
   * Starts sending `track` (Serble's processed mic) to Discord.
   * @param {object} o
   * @param {() => boolean} o.isMuted
   * @param {() => number} o.threshold Voice activity threshold, in dBFS
   * @param {(opus: Uint8Array, timestamp: number) => void} o.onPacket
   * @param {() => void} o.onSilence When speech stops
   * @param {(speaking: boolean) => void} o.onSpeaking
   */
  async startCapture(track, o) {
    await this.init();
    if (this.capture?.track === track) return;
    this.stopCapture();
    const source = this.ctx.createMediaStreamSource(new MediaStream([track]));
    const node = new AudioWorkletNode(this.ctx, 'discord-link-capture', { numberOfInputs: 1, numberOfOutputs: 1, channelCount: 2, channelCountMode: 'explicit' });
    // It only runs while connected through to the output (silently)
    const sink = this.ctx.createGain();
    sink.gain.value = 0;
    source.connect(node).connect(sink).connect(this.ctx.destination);

    const capture = { track, source, node, sink, encoder: null, speaking: false, hangover: 0 };
    this.capture = capture;
    const config = { codec: 'opus', sampleRate: SAMPLE_RATE, numberOfChannels: 2, bitrate: 96000, opus: { frameDuration: 20000, complexity: 10, useinbandfec: true } };
    const { supported } = await AudioEncoder.isConfigSupported(config).catch(() => ({ supported: false }));
    if (this.capture !== capture) return;
    capture.encoder = new AudioEncoder({
      output: (chunk) => {
        const bytes = new Uint8Array(chunk.byteLength);
        chunk.copyTo(bytes);
        o.onPacket(bytes, Math.round(chunk.timestamp * SAMPLE_RATE / 1e6) >>> 0);
      },
      error: (err) => this.log.error('Opus encoder failed:', err),
    });
    capture.encoder.configure(supported ? config : { codec: 'opus', sampleRate: SAMPLE_RATE, numberOfChannels: 2, bitrate: 96000 });

    // How long speech keeps the mic open after it goes quiet
    const HANGOVER_FRAMES = 20;
    node.port.onmessage = ({ data: { l, r, frame } }) => {
      if (this.capture !== capture || capture.encoder?.state !== 'configured') return;
      let energy = 0;
      for (let i = 0; i < l.length; i++) energy += l[i] * l[i] + r[i] * r[i];
      const db = 10 * Math.log10(energy / (2 * l.length) + 1e-12);
      const loud = !o.isMuted() && db > o.threshold();
      if (loud) capture.hangover = HANGOVER_FRAMES;
      else if (capture.hangover > 0) capture.hangover--;
      const speaking = capture.hangover > 0 && !o.isMuted();
      if (speaking !== capture.speaking) {
        capture.speaking = speaking;
        o.onSpeaking(speaking);
        if (!speaking) o.onSilence();
      }
      if (!speaking) return;
      const pcm = new Float32Array(l.length * 2);
      pcm.set(l, 0);
      pcm.set(r, l.length);
      const audio = new AudioData({ format: 'f32-planar', sampleRate: SAMPLE_RATE, numberOfFrames: l.length, numberOfChannels: 2, timestamp: frame * 20000, data: pcm });
      capture.encoder.encode(audio);
      audio.close();
    };
  }

  stopCapture() {
    const c = this.capture;
    if (!c) return;
    this.capture = null;
    c.node.port.onmessage = null;
    try { c.source.disconnect(); c.node.disconnect(); c.sink.disconnect(); } catch { /* gone */ }
    try { c.encoder?.close(); } catch { /* gone */ }
  }

  get capturing() {
    return !!this.capture;
  }

  async close() {
    this.stopCapture();
    for (const key of [...this.decoders.keys()]) this.remove(key);
    await this.ctx?.close().catch(() => {});
    this.ctx = null;
    this.player = null;
    this.ready = null;
  }
}
