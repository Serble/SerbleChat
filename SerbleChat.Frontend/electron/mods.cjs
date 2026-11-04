// Client mods: folders of code the user installs that run with full access to the app.
//
// Each mod is a folder in <userData>/mods (or in a folder listed in SERBLE_MODS_DIR) with a
// mod.json manifest. A mod can have two halves:
//  - main:     a CommonJS (or .mjs) file run here, in Electron's main process, with full Node.js
//              (network, UDP, files, native modules, anything in the mod's own node_modules)
//  - renderer: an ES module the page imports (src/mods/loader.js), with the app's internals
// The halves talk over ctx.ipc / api.ipc. See MODDING.md.
//
// Mods start disabled: they run with the user's full privileges, so turning one on is a choice.

const { app, ipcMain, protocol, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const util = require('util');
const { pathToFileURL } = require('url');

const SCHEME = 'serble-mod';
// Lowercase only: the scheme is "standard", so the URL host (the mod's ID) gets lowercased
const START_TIMEOUT_MS = 5000;
const MOD_ID = /^[a-z0-9][a-z0-9._-]{0,63}$/;

const MIME_TYPES = {
  '.js': 'text/javascript', '.mjs': 'text/javascript', '.cjs': 'text/javascript',
  '.json': 'application/json', '.css': 'text/css', '.html': 'text/html', '.txt': 'text/plain',
  '.wasm': 'application/wasm', '.map': 'application/json',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif',
  '.webp': 'image/webp', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
  '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.wav': 'audio/wav', '.webm': 'video/webm', '.mp4': 'video/mp4',
  '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.otf': 'font/otf',
};

/** Must run before the app is ready: lets the page import mod files from serble-mod://<id>/... */
function registerModScheme() {
  protocol.registerSchemesAsPrivileged([{
    scheme: SCHEME,
    privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true },
  }]);
}

/** Resolves `rel` inside `dir`, or null if it would point outside it. */
function resolveInside(dir, rel) {
  const full = path.resolve(dir, rel);
  return full === dir || full.startsWith(dir + path.sep) ? full : null;
}

class ModManager {
  /** @param {{ getMainWindow: () => Electron.BrowserWindow | null }} options */
  constructor({ getMainWindow }) {
    this.getMainWindow = getMainWindow;
    this.userDir = path.join(app.getPath('userData'), 'mods');
    this.dataRoot = path.join(app.getPath('userData'), 'mod-data');
    this.statePath = path.join(app.getPath('userData'), 'mods.json');
    // Extra folders to look in (for developing a mod where it lives), separated like PATH
    this.extraDirs = (process.env.SERBLE_MODS_DIR ?? '').split(path.delimiter).filter(Boolean).map(d => path.resolve(d));
    /** @type {Map<string, object>} id -> mod record */
    this.mods = new Map();
    this.state = this.loadState();
  }

  // ── State (which mods are on) ──

  loadState() {
    try {
      const parsed = JSON.parse(fs.readFileSync(this.statePath, 'utf8'));
      return { enabled: parsed?.enabled && typeof parsed.enabled === 'object' ? parsed.enabled : {} };
    } catch {
      return { enabled: {} };
    }
  }

  saveState() {
    try {
      fs.writeFileSync(this.statePath, JSON.stringify(this.state, null, 2));
    } catch (err) {
      console.error('[mods] Failed to save mod state:', err);
    }
  }

  isEnabled(id) {
    return this.state.enabled[id] === true;
  }

  // ── Finding mods ──

  /** Folders holding mods: each subfolder with a mod.json is one, as is a folder that is itself a mod. */
  modFolders() {
    try { fs.mkdirSync(this.userDir, { recursive: true }); } catch { /* reported when reading */ }
    const folders = [];
    for (const root of [this.userDir, ...this.extraDirs]) {
      if (fs.existsSync(path.join(root, 'mod.json'))) {
        folders.push(root);
        continue;
      }
      let entries = [];
      try { entries = fs.readdirSync(root, { withFileTypes: true }); } catch { continue; }
      for (const entry of entries) {
        if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
        const dir = path.join(root, entry.name);
        if (fs.existsSync(path.join(dir, 'mod.json'))) folders.push(dir);
      }
    }
    return folders;
  }

  /** Reads one mod's manifest into a record (with `problem` set if it can't be loaded). */
  readMod(dir) {
    const record = { dir: fs.realpathSync(dir), folder: path.basename(dir), problem: null };
    let manifest;
    try {
      manifest = JSON.parse(fs.readFileSync(path.join(dir, 'mod.json'), 'utf8'));
    } catch (err) {
      return { ...record, id: record.folder.toLowerCase(), manifest: {}, problem: `Couldn't read mod.json: ${err.message}` };
    }
    const id = typeof manifest.id === 'string' ? manifest.id : record.folder.toLowerCase();
    const result = { ...record, id, manifest };
    if (!MOD_ID.test(id)) return { ...result, problem: `Invalid id "${id}" (use lowercase letters, digits, ".", "-" and "_")` };
    for (const key of ['main', 'renderer']) {
      if (manifest[key] == null) continue;
      if (typeof manifest[key] !== 'string' || !resolveInside(result.dir, manifest[key])) {
        return { ...result, problem: `"${key}" must be a path inside the mod's folder` };
      }
    }
    if (!manifest.main && !manifest.renderer) return { ...result, problem: 'mod.json has neither "main" nor "renderer"' };
    return result;
  }

  scan() {
    const found = new Map();
    for (const dir of this.modFolders()) {
      let mod;
      try { mod = this.readMod(dir); } catch (err) { console.error(`[mods] Failed to read ${dir}:`, err); continue; }
      if (found.has(mod.id)) {
        console.warn(`[mods] Skipping ${mod.dir}: another mod (${found.get(mod.id).dir}) already has the id "${mod.id}"`);
        continue;
      }
      found.set(mod.id, mod);
    }
    return found;
  }

  // ── Running mods ──

  async startAll() {
    const found = this.scan();
    for (const [id, mod] of found) {
      const running = { ...mod, status: 'stopped', error: null, ctx: null, exports: null };
      this.mods.set(id, running);
      if (mod.problem) {
        running.status = 'error';
        running.error = mod.problem;
        continue;
      }
      if (!this.isEnabled(id)) {
        running.status = 'disabled';
        continue;
      }
      await this.startMod(running);
    }
  }

  async startMod(mod) {
    if (!mod.manifest.main) {
      mod.status = 'running';
      return;
    }
    const ctx = this.createContext(mod);
    mod.ctx = ctx;
    try {
      const entry = resolveInside(mod.dir, mod.manifest.main);
      let exported;
      if (entry.endsWith('.mjs')) {
        // ESM can't be uncached: reloading picks up changes to the entry file only
        exported = await import(`${pathToFileURL(entry).href}?v=${Date.now()}`);
        exported = exported.default ?? exported;
      } else {
        exported = require(entry);
      }
      mod.exports = exported;
      const start = typeof exported === 'function' ? exported : exported?.start;
      mod.status = 'running';
      if (typeof start === 'function') {
        // The window waits for mods to start, so don't let a slow one (logging in somewhere,
        // say) hold it up: past a few seconds it carries on starting in the background.
        const started = Promise.resolve(start(ctx)).then(result => {
          if (typeof result === 'function') ctx.onStop(result);
        });
        const timedOut = await Promise.race([
          started.then(() => false),
          new Promise(resolve => setTimeout(() => resolve(true), START_TIMEOUT_MS)),
        ]);
        if (timedOut) {
          console.warn(`[mods] ${mod.id} is taking a while to start; carrying on without waiting`);
          started.catch(err => this.failed(mod, ctx, err));
          return;
        }
      }
      console.log(`[mods] Started ${mod.id}`);
    } catch (err) {
      await this.failed(mod, ctx, err);
    }
  }

  async failed(mod, ctx, err) {
    console.error(`[mods] ${mod.id} failed to start:`, err);
    // Already stopped (or restarted) while it was still starting
    if (mod.ctx !== ctx) return;
    mod.status = 'error';
    mod.error = err?.stack || String(err);
    await this.cleanUp(mod);
  }

  async stopMod(mod) {
    if (mod.status !== 'running') {
      await this.cleanUp(mod);
      return;
    }
    try {
      if (typeof mod.exports?.stop === 'function') await mod.exports.stop();
    } catch (err) {
      console.error(`[mods] ${mod.id} failed to stop cleanly:`, err);
    }
    await this.cleanUp(mod);
    mod.status = 'stopped';
  }

  /** Runs the mod's cleanups and forgets its code, so starting it again loads it fresh. */
  async cleanUp(mod) {
    const ctx = mod.ctx;
    if (ctx) {
      for (const fn of ctx._cleanups.splice(0).reverse()) {
        try { await fn(); } catch (err) { console.error(`[mods] ${mod.id} cleanup failed:`, err); }
      }
      ctx._handlers.clear();
      ctx._listeners.clear();
    }
    mod.ctx = null;
    mod.exports = null;
    for (const key of Object.keys(require.cache)) {
      if (key.startsWith(mod.dir + path.sep)) delete require.cache[key];
    }
  }

  async stopAll() {
    for (const mod of this.mods.values()) await this.stopMod(mod);
  }

  async reload() {
    await this.stopAll();
    this.mods.clear();
    await this.startAll();
  }

  /** What a mod's main half gets to work with (`ctx`). */
  createContext(mod) {
    const manager = this;
    const prefix = `[mod:${mod.id}]`;
    const forward = (level, args) => {
      console[level](prefix, ...args);
      const win = manager.getMainWindow();
      if (win && !win.isDestroyed()) {
        win.webContents.send('mod-log', mod.id, level, util.format(...args));
      }
    };
    const ctx = {
      id: mod.id,
      manifest: mod.manifest,
      dir: mod.dir,
      get dataDir() {
        const dir = path.join(manager.dataRoot, mod.id);
        fs.mkdirSync(dir, { recursive: true });
        return dir;
      },
      electron: require('electron'),
      getMainWindow: () => manager.getMainWindow(),
      log: (...args) => forward('log', args),
      warn: (...args) => forward('warn', args),
      error: (...args) => forward('error', args),
      /** Runs when the mod stops (disabled, reloaded or the app quits). */
      onStop(fn) {
        ctx._cleanups.push(fn);
        return fn;
      },
      ipc: {
        /** Answers api.ipc.invoke(channel, ...args) from the mod's renderer half. */
        handle(channel, fn) {
          ctx._handlers.set(String(channel), fn);
          return () => ctx._handlers.delete(String(channel));
        },
        /** Hears api.ipc.send(channel, ...args) from the mod's renderer half. */
        on(channel, fn) {
          const key = String(channel);
          if (!ctx._listeners.has(key)) ctx._listeners.set(key, new Set());
          ctx._listeners.get(key).add(fn);
          return () => ctx._listeners.get(key)?.delete(fn);
        },
        /** Sends to api.ipc.on(channel, ...) in the mod's renderer half. False if there's no window. */
        send(channel, ...args) {
          const win = manager.getMainWindow();
          if (!win || win.isDestroyed()) return false;
          win.webContents.send('mod-event', mod.id, String(channel), ...args);
          return true;
        },
      },
      _cleanups: [],
      _handlers: new Map(),
      _listeners: new Map(),
    };
    return ctx;
  }

  // ── What the page sees ──

  describe(mod) {
    const m = mod.manifest ?? {};
    return {
      id: mod.id,
      name: typeof m.name === 'string' ? m.name : mod.id,
      version: typeof m.version === 'string' ? m.version : null,
      description: typeof m.description === 'string' ? m.description : null,
      author: typeof m.author === 'string' ? m.author : null,
      dir: mod.dir,
      hasMain: !!m.main,
      // Where the page imports the renderer half from
      rendererUrl: m.renderer && !mod.problem ? `${SCHEME}://${mod.id}/${m.renderer.replace(/^\.?\//, '').split(path.sep).join('/')}` : null,
      enabled: this.isEnabled(mod.id),
      status: mod.status,
      error: mod.error,
    };
  }

  registerProtocol() {
    protocol.handle(SCHEME, async (request) => {
      const headers = { 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-store' };
      try {
        const url = new URL(request.url);
        const mod = this.mods.get(url.hostname);
        // Only mods that are on can be loaded from
        if (!mod || !this.isEnabled(mod.id) || mod.problem) return new Response('Not found', { status: 404, headers });
        const file = resolveInside(mod.dir, '.' + decodeURIComponent(url.pathname));
        if (!file) return new Response('Forbidden', { status: 403, headers });
        const body = await fs.promises.readFile(file);
        const type = MIME_TYPES[path.extname(file).toLowerCase()] ?? 'application/octet-stream';
        return new Response(body, { status: 200, headers: { ...headers, 'Content-Type': type } });
      } catch (err) {
        return new Response(err.code === 'ENOENT' ? 'Not found' : 'Error', { status: err.code === 'ENOENT' ? 404 : 500, headers });
      }
    });
  }

  registerIpc() {
    // Only the app's own window gets to drive mods (not popped-out stream windows)
    const fromMain = (event) => {
      const win = this.getMainWindow();
      return !!win && event.sender === win.webContents;
    };

    ipcMain.handle('mods-list', (event) => {
      if (!fromMain(event)) return [];
      return [...this.mods.values()].map(m => this.describe(m));
    });

    ipcMain.handle('mods-set-enabled', (event, id, enabled) => {
      if (!fromMain(event) || !this.mods.has(String(id))) return false;
      this.state.enabled[String(id)] = !!enabled;
      this.saveState();
      return true;
    });

    // Stops every mod and starts the enabled ones again (with their code loaded fresh).
    // The page reloads itself afterwards to do the same for the renderer halves.
    ipcMain.handle('mods-reload', async (event) => {
      if (!fromMain(event)) return [];
      await this.reload();
      return [...this.mods.values()].map(m => this.describe(m));
    });

    ipcMain.handle('mods-folder', (event) => (fromMain(event) ? this.userDir : null));

    ipcMain.handle('mods-open-folder', async (event) => {
      if (!fromMain(event)) return false;
      fs.mkdirSync(this.userDir, { recursive: true });
      const error = await shell.openPath(this.userDir);
      return error ? { success: false, error } : { success: true, path: this.userDir };
    });

    ipcMain.handle('mod-invoke', async (event, id, channel, ...args) => {
      if (!fromMain(event)) throw new Error('Not allowed');
      const mod = this.mods.get(String(id));
      const handler = mod?.ctx?._handlers.get(String(channel));
      if (!handler) throw new Error(`Mod "${id}" has no handler for "${channel}"`);
      return handler(...args);
    });

    ipcMain.on('mod-send', (event, id, channel, ...args) => {
      if (!fromMain(event)) return;
      const listeners = this.mods.get(String(id))?.ctx?._listeners.get(String(channel));
      for (const fn of listeners ?? []) {
        try { fn(...args); } catch (err) { console.error(`[mods] ${id} listener for "${channel}" threw:`, err); }
      }
    });
  }
}

module.exports = { ModManager, registerModScheme };
