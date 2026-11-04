// Stream audio on Linux, through PipeWire.
//
// Chromium can't capture system audio on Linux, so we do it in PipeWire's graph instead:
//   1. Create a virtual microphone (a null-audio-sink node with the Audio/Source/Virtual class).
//   2. Watch the graph and link every app's playback stream into it, except our own, so
//      viewers never hear the call (or themselves) back. The app keeps playing to the
//      speakers as normal: a PipeWire port can feed more than one link.
//   3. The page captures the virtual mic with getUserMedia and publishes it as stream audio.
//
// It only uses PipeWire's own command line tools (pw-cli, pw-dump, pw-link), so there's no
// native module to build. The virtual mic belongs to a pw-cli process that's tied to ours:
// if we exit or crash, it goes, and PipeWire removes the mic and every link to it.

const { spawn, execFile } = require('child_process');
const fs = require('fs');
const path = require('path');

const NODE_NAME = 'serble-chat-stream-audio';
// What the mic is called in device lists (Chromium's label for it, pavucontrol, etc.)
const NODE_DESCRIPTION = 'Serble Chat Stream Audio';

function run(cmd, args, timeout = 5000) {
  return new Promise(resolve => {
    execFile(cmd, args, { timeout, maxBuffer: 64 * 1024 * 1024 }, (err, stdout, stderr) => {
      resolve({ ok: !err, stdout: String(stdout ?? ''), stderr: String(stderr ?? ''), err });
    });
  });
}

/**
 * Whether stream audio can work here. Returns { supported, reason }: the reason is
 * something to show the user when it can't.
 */
async function checkSupport() {
  if (process.platform !== 'linux') return { supported: false, reason: 'Not Linux' };
  for (const tool of ['pw-cli', 'pw-dump', 'pw-link']) {
    const r = await run(tool, ['--version']);
    if (!r.ok) {
      return { supported: false, reason: `Sharing audio needs PipeWire's tools (${tool} wasn't found). Install pipewire-utils (Fedora), pipewire-bin (Debian/Ubuntu) or pipewire (Arch).` };
    }
  }
  const dump = await run('pw-dump', ['--no-colors']);
  if (!dump.ok) return { supported: false, reason: 'Sharing audio needs PipeWire, and it isn\'t running.' };
  // Chromium reaches audio devices through the PulseAudio API, which PipeWire provides
  // with pipewire-pulse
  const runtimeDir = process.env.XDG_RUNTIME_DIR;
  const pulseServer = process.env.PULSE_SERVER;
  if (!pulseServer && runtimeDir && !fs.existsSync(path.join(runtimeDir, 'pulse', 'native'))) {
    return { supported: false, reason: 'Sharing audio needs pipewire-pulse, and it isn\'t running.' };
  }
  return { supported: true, reason: null };
}

/**
 * Splits pw-dump's output into the JSON documents in it. In monitor mode it prints one
 * array per batch of changes, one after another.
 */
class JsonStreamSplitter {
  constructor(onDocument) {
    this.onDocument = onDocument;
    this.buffer = '';
    this.depth = 0;
    this.inString = false;
    this.escaped = false;
    this.start = -1;
    this.scanned = 0;
  }

  push(chunk) {
    this.buffer += chunk;
    for (let i = this.scanned; i < this.buffer.length; i++) {
      const c = this.buffer[i];
      if (this.inString) {
        if (this.escaped) this.escaped = false;
        else if (c === '\\') this.escaped = true;
        else if (c === '"') this.inString = false;
        continue;
      }
      if (c === '"') this.inString = true;
      else if (c === '[' || c === '{') {
        if (this.depth === 0) this.start = i;
        this.depth++;
      } else if (c === ']' || c === '}') {
        this.depth--;
        if (this.depth === 0 && this.start >= 0) {
          const text = this.buffer.slice(this.start, i + 1);
          try { this.onDocument(JSON.parse(text)); } catch (err) { console.warn('[stream-audio] Bad pw-dump output:', err.message); }
          this.buffer = this.buffer.slice(i + 1);
          this.start = -1;
          i = -1;
        }
      }
    }
    this.scanned = this.buffer.length;
    if (this.depth === 0) { this.buffer = ''; this.scanned = 0; }
  }
}

/** The audio graph, as pw-dump describes it: every object by id. */
class Graph {
  constructor() { this.objects = new Map(); }

  apply(objects) {
    for (const obj of objects) {
      if (obj.info === null) this.objects.delete(obj.id);
      else this.objects.set(obj.id, obj);
    }
  }

  ofType(suffix) {
    return [...this.objects.values()].filter(o => o.type?.endsWith(suffix));
  }

  props(obj) { return obj.info?.props ?? {}; }
}

function isPlaybackStream(props) {
  return props['media.class'] === 'Stream/Output/Audio';
}

/**
 * Whether a playback stream is something an app is playing, rather than audio being passed
 * along by something else (a loopback, an effects chain, another screen share tool). Those
 * carry other apps' sound, which we'd already have, and sometimes ours, which would echo.
 */
function isAppStream(props) {
  if (!isPlaybackStream(props)) return false;
  if (props['node.virtual'] === true || props['node.virtual'] === 'true') return false;
  if (props['node.link-group']) return false;
  if (props['stream.monitor'] === true || props['stream.monitor'] === 'true') return false;
  if (props['stream.capture.sink'] === true || props['stream.capture.sink'] === 'true') return false;
  return true;
}

/** How we name an app, so a choice of apps survives the app restarting (new ids and pids). */
function appKey(props) {
  return String(props['application.process.binary'] || props['application.name'] || props['node.name'] || '');
}

/** Which of our two channels a port's audio goes to. */
function targetChannels(channel) {
  const c = String(channel || '').toUpperCase();
  if (c === 'FL' || c === 'RL' || c === 'SL' || c === 'FLC' || c === 'AUX0') return ['FL'];
  if (c === 'FR' || c === 'RR' || c === 'SR' || c === 'FRC' || c === 'AUX1') return ['FR'];
  // Mono, centre, LFE and anything unknown: both sides
  return ['FL', 'FR'];
}

class LinuxStreamAudio {
  /**
   * @param {() => (number|string)[]} getOwnPids - Our process ids. Anything they play is left out.
   */
  constructor(getOwnPids) {
    this.getOwnPids = getOwnPids;
    this.ownerProcess = null;
    this.monitorProcess = null;
    this.graph = null;
    /** null: every app. Otherwise the appKeys to share. */
    this.apps = null;
    this.pendingLinks = new Set();
    this.failedLinks = new Set();
    this.syncTimer = null;
    this.waiters = [];
  }

  get isActive() { return !!this.ownerProcess; }

  /** The apps playing sound right now (not us), to choose from. */
  async listApps() {
    const dump = await run('pw-dump', ['--no-colors']);
    if (!dump.ok) return [];
    let objects;
    try { objects = JSON.parse(dump.stdout); } catch { return []; }
    const own = new Set(this.getOwnPids().map(String));
    const apps = new Map();
    for (const obj of objects) {
      if (!obj.type?.endsWith('Node')) continue;
      const props = obj.info?.props ?? {};
      if (!isAppStream(props)) continue;
      if (own.has(String(props['application.process.id']))) continue;
      const key = appKey(props);
      if (!key || apps.has(key)) continue;
      apps.set(key, {
        id: key,
        name: String(props['application.name'] || key),
        binary: props['application.process.binary'] ? String(props['application.process.binary']) : null,
        icon: props['application.icon-name'] ? String(props['application.icon-name']) : null,
      });
    }
    return [...apps.values()].sort((a, b) => a.name.localeCompare(b.name));
  }

  /**
   * Creates the virtual mic and starts feeding it. Resolves with the mic's label, for the
   * page to find it by, once it exists.
   * @param {{ apps?: string[] | null }} options - apps: only these (appKeys), or null for everything
   */
  async start({ apps = null } = {}) {
    if (this.isActive) {
      this.setApps(apps);
      return { label: NODE_DESCRIPTION };
    }
    this.apps = apps?.length ? apps.map(String) : null;
    this.graph = new Graph();
    this.pendingLinks.clear();
    this.failedLinks.clear();

    const props = [
      'factory.name=support.null-audio-sink',
      `node.name=${NODE_NAME}`,
      `node.description="${NODE_DESCRIPTION}"`,
      'media.class=Audio/Source/Virtual',
      'audio.position=[ FL FR ]',
      // Never chosen as anyone's default mic
      'priority.session=0',
      'priority.driver=0',
      'node.always-process=true',
    ].join(' ');
    // pw-cli keeps the node alive for as long as it runs, but doesn't notice its parent dying.
    // The shell does: when our end of its stdin closes (exit or crash), `read` returns and it
    // stops pw-cli, which takes the node with it.
    this.ownerProcess = spawn('sh', ['-c', 'pw-cli -m "$1" >/dev/null 2>&1 & p=$!; trap \'kill $p 2>/dev/null\' EXIT TERM; read _; kill $p 2>/dev/null', 'sh', `create-node adapter { ${props} }`], {
      stdio: ['pipe', 'ignore', 'pipe'],
    });
    const owner = this.ownerProcess;
    owner.on('exit', () => {
      if (this.ownerProcess === owner) {
        console.warn('[stream-audio] Virtual mic owner exited');
        this.stop();
      }
    });

    this.monitorProcess = spawn('pw-dump', ['--monitor', '--no-colors'], { stdio: ['ignore', 'pipe', 'pipe'] });
    const splitter = new JsonStreamSplitter(doc => {
      if (!this.graph) return;
      this.graph.apply(Array.isArray(doc) ? doc : [doc]);
      this.scheduleSync();
    });
    this.monitorProcess.stdout.setEncoding('utf8');
    this.monitorProcess.stdout.on('data', chunk => splitter.push(chunk));
    const monitor = this.monitorProcess;
    monitor.on('exit', code => {
      if (this.monitorProcess === monitor) {
        console.warn('[stream-audio] pw-dump exited with', code);
        this.stop();
      }
    });

    try {
      await this.waitFor(() => this.ourInputPorts().size === 2, 5000);
    } catch (err) {
      this.stop();
      throw new Error('PipeWire didn\'t create the stream audio device');
    }
    console.log('[stream-audio] Virtual mic ready', this.apps ? `for ${this.apps.join(', ')}` : 'for all apps');
    return { label: NODE_DESCRIPTION };
  }

  /** Changes which apps are shared, without restarting. */
  setApps(apps) {
    this.apps = apps?.length ? apps.map(String) : null;
    this.scheduleSync();
  }

  stop() {
    const owner = this.ownerProcess;
    const monitor = this.monitorProcess;
    this.ownerProcess = null;
    this.monitorProcess = null;
    this.graph = null;
    clearTimeout(this.syncTimer);
    this.syncTimer = null;
    for (const w of this.waiters.splice(0)) w.reject(new Error('Stopped'));
    // Closing its stdin makes the shell stop pw-cli; the node and its links go with it
    try { owner?.stdin.end(); } catch { /* already gone */ }
    try { owner?.kill('SIGTERM'); } catch { /* already gone */ }
    try { monitor?.kill('SIGTERM'); } catch { /* already gone */ }
    if (owner) console.log('[stream-audio] Stopped');
  }

  waitFor(condition, timeout) {
    if (condition()) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const waiter = { condition, resolve, reject };
      waiter.timer = setTimeout(() => {
        this.waiters = this.waiters.filter(w => w !== waiter);
        reject(new Error('Timed out'));
      }, timeout);
      this.waiters.push(waiter);
    });
  }

  ourNode() {
    return this.graph?.ofType('Node').find(n => this.graph.props(n)['node.name'] === NODE_NAME) ?? null;
  }

  /** Our mic's input ports, by channel. */
  ourInputPorts() {
    const node = this.ourNode();
    const ports = new Map();
    if (!node) return ports;
    for (const port of this.graph.ofType('Port')) {
      const props = this.graph.props(port);
      if (Number(props['node.id']) !== node.id) continue;
      if (port.info.direction !== 'input') continue;
      ports.set(String(props['audio.channel'] ?? '').toUpperCase(), port.id);
    }
    return ports;
  }

  scheduleSync() {
    if (this.syncTimer) return;
    // Changes come in bursts (a new stream brings its node, ports and links), so batch them
    this.syncTimer = setTimeout(() => {
      this.syncTimer = null;
      this.sync();
    }, 30);
  }

  /** Brings our links in line with what should be shared. */
  sync() {
    if (!this.graph) return;
    for (const w of [...this.waiters]) {
      if (w.condition()) {
        clearTimeout(w.timer);
        this.waiters = this.waiters.filter(x => x !== w);
        w.resolve();
      }
    }

    const node = this.ourNode();
    const inputs = this.ourInputPorts();
    if (!node || inputs.size === 0) return;

    const own = new Set(this.getOwnPids().map(String));
    const wantedNodes = new Set();
    // Of those, the ones playing right now. PipeWire won't link a paused (idle) stream's ports,
    // so those wait until they play. Links already made stay through a pause.
    const runningNodes = new Set();
    for (const n of this.graph.ofType('Node')) {
      const props = this.graph.props(n);
      if (!isAppStream(props)) continue;
      if (own.has(String(props['application.process.id']))) continue;
      if (this.apps && !this.apps.includes(appKey(props))) continue;
      wantedNodes.add(n.id);
      if (n.info?.state === 'running') runningNodes.add(n.id);
    }

    // The links we want: each output port of each wanted stream, into the matching side
    const wanted = new Set();
    const toCreate = new Set();
    for (const port of this.graph.ofType('Port')) {
      if (port.info?.direction !== 'output') continue;
      const props = this.graph.props(port);
      const nodeId = Number(props['node.id']);
      if (!wantedNodes.has(nodeId)) continue;
      if (props['port.monitor'] === true || props['port.monitor'] === 'true') continue;
      for (const channel of targetChannels(props['audio.channel'])) {
        const input = inputs.get(channel);
        if (input === undefined) continue;
        wanted.add(`${port.id}:${input}`);
        if (runningNodes.has(nodeId)) toCreate.add(`${port.id}:${input}`);
      }
    }

    // The links into our mic right now
    const ourInputIds = new Set(inputs.values());
    const existing = new Map();
    for (const link of this.graph.ofType('Link')) {
      const info = link.info;
      if (!ourInputIds.has(info['input-port-id'])) continue;
      existing.set(`${info['output-port-id']}:${info['input-port-id']}`, link.id);
    }

    for (const key of toCreate) {
      if (existing.has(key) || this.pendingLinks.has(key)) continue;
      const [out, inp] = key.split(':');
      this.pendingLinks.add(key);
      // Lingering links belong to PipeWire rather than pw-link, so they outlive it. They
      // still go when our mic does.
      run('pw-link', ['-L', out, inp]).then(r => {
        this.pendingLinks.delete(key);
        if (!this.graph) return;
        if (!r.ok && !/File exists/i.test(r.stderr) && !this.failedLinks.has(key)) {
          // Only said once per link: it's retried on every change, and may keep failing
          this.failedLinks.add(key);
          const port = this.graph?.objects.get(Number(out));
          const from = this.graph?.objects.get(Number(this.graph.props(port ?? {})['node.id']));
          console.warn(`[stream-audio] Couldn't link ${out} (${appKey(this.graph?.props(from ?? {}) ?? {})}) -> ${inp}:`, r.stderr.trim());
        }
      });
    }
    // Apps no longer chosen (or our own, if a pid only just became known)
    for (const [key, linkId] of existing) {
      if (wanted.has(key)) continue;
      run('pw-link', ['-d', String(linkId)]);
    }
  }
}

module.exports = { LinuxStreamAudio, checkSupport, NODE_DESCRIPTION };
