// Decodes a Discord video feed (a Go Live stream or a camera) onto a canvas with WebCodecs.

const CLOCK = 90000;

/** "avc1.PPCCLL" from the SPS in an Annex B keyframe, or a common default. */
function h264CodecString(data) {
  for (let i = 0; i + 4 < data.length; i++) {
    if (data[i] === 0 && data[i + 1] === 0 && data[i + 2] === 1 && (data[i + 3] & 0x1f) === 7) {
      const hex = (b) => b.toString(16).padStart(2, '0');
      return `avc1.${hex(data[i + 4])}${hex(data[i + 5])}${hex(data[i + 6])}`;
    }
  }
  return 'avc1.42e01f';
}

export class VideoSink {
  /**
   * @param {object} o
   * @param {() => void} o.requestKeyframe
   * @param {(info: { width, height, fps, error }) => void} o.onInfo
   */
  constructor({ requestKeyframe, onInfo, log }) {
    this.requestKeyframe = requestKeyframe;
    this.onInfo = onInfo;
    this.log = log;
    this.canvas = document.createElement('canvas');
    this.canvas.width = 1280;
    this.canvas.height = 720;
    this.g = this.canvas.getContext('2d');
    this.decoder = null;
    this.codec = null;
    this.codecString = null;
    this.waitingForKeyframe = true;
    this.lastRaw = null;
    this.unwrapped = 0;
    this.frames = 0;
    this.fps = 0;
    this.error = null;
    this.fpsTimer = setInterval(() => {
      this.fps = this.frames;
      this.frames = 0;
      this.report();
    }, 1000);
  }

  report() {
    this.onInfo({ width: this.canvas.width, height: this.canvas.height, fps: this.fps, error: this.error, waiting: this.waitingForKeyframe });
  }

  async configure(codec, keyframeData) {
    this.closeDecoder();
    const codecString = codec === 'VP8' ? 'vp8' : h264CodecString(keyframeData);
    const config = { codec: codecString, optimizeForLatency: true };
    const { supported } = await VideoDecoder.isConfigSupported(config).catch(() => ({ supported: false }));
    if (!supported) {
      this.error = `This app can't decode ${codec} (${codecString})`;
      this.report();
      return false;
    }
    this.decoder = new VideoDecoder({
      output: (frame) => this.draw(frame),
      error: (err) => {
        this.log.warn('Video decoder failed:', err.message);
        this.decoder = null;
        this.waitingForKeyframe = true;
        this.requestKeyframe();
      },
    });
    this.decoder.configure(config);
    this.codec = codec;
    this.codecString = codecString;
    this.error = null;
    return true;
  }

  /** One whole encoded frame. */
  async push(codec, keyframe, discontinuity, rtpTimestamp, data) {
    if (this.lastRaw === null) this.unwrapped = 0;
    else this.unwrapped += (rtpTimestamp - this.lastRaw) | 0;
    this.lastRaw = rtpTimestamp;

    // Something was lost: carry on (a few frames may smear) and ask for a fresh keyframe, rather than
    // freezing until the next one. Only a decoder error makes us wait for one.
    if (discontinuity && !keyframe) this.requestKeyframe();
    if (this.waitingForKeyframe && !keyframe) return;
    if (keyframe && (!this.decoder || this.codec !== codec || this.decoder.state === 'closed')) {
      if (this.configuring) return;
      this.configuring = true;
      try {
        if (!(await this.configure(codec, data))) return;
      } finally {
        this.configuring = false;
      }
    }
    if (!this.decoder || this.decoder.state !== 'configured') return;
    this.waitingForKeyframe = false;
    // Falling behind (a slow machine): skip to the next keyframe rather than lag further
    if (this.decoder.decodeQueueSize > 30) {
      this.waitingForKeyframe = true;
      this.requestKeyframe();
      return;
    }
    try {
      this.decoder.decode(new EncodedVideoChunk({ type: keyframe ? 'key' : 'delta', timestamp: Math.round(this.unwrapped * 1e6 / CLOCK), data }));
    } catch (err) {
      this.log.warn('Video decode failed:', err.message);
      this.waitingForKeyframe = true;
      this.requestKeyframe();
    }
  }

  draw(frame) {
    try {
      const w = frame.displayWidth, h = frame.displayHeight;
      if (this.canvas.width !== w || this.canvas.height !== h) {
        this.canvas.width = w;
        this.canvas.height = h;
        this.report();
      }
      this.g.drawImage(frame, 0, 0, w, h);
      this.frames++;
    } finally {
      frame.close();
    }
  }

  closeDecoder() {
    try { this.decoder?.close(); } catch { /* already closed */ }
    this.decoder = null;
  }

  close() {
    clearInterval(this.fpsTimer);
    this.closeDecoder();
  }
}
