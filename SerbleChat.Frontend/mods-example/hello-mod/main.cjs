// The main half: runs in Electron's main process with full Node.js. Anything in this folder's
// node_modules can be required (a Discord client, say). `ctx` is described in MODDING.md.
const os = require('os');
const dgram = require('dgram');

module.exports = {
  start(ctx) {
    ctx.log(`Hello from the main process (node ${process.versions.node}, electron ${process.versions.electron})`);

    // Answer the renderer half's api.ipc.invoke('info')
    ctx.ipc.handle('info', () => ({
      hostname: os.hostname(),
      platform: process.platform,
      uptime: Math.round(os.uptime()),
      dataDir: ctx.dataDir,
    }));

    // Raw UDP works here (what a voice protocol needs): echo a packet to ourselves
    ctx.ipc.handle('udp-echo', (text) => new Promise((resolve, reject) => {
      const s = dgram.createSocket('udp4');
      s.once('error', reject);
      s.once('message', (msg) => { s.close(); resolve(msg.toString()); });
      s.bind(0, '127.0.0.1', () => s.send(Buffer.from(String(text)), s.address().port, '127.0.0.1'));
    }));

    // Binary data goes both ways: the renderer streams call audio here as Float32Array chunks
    let samples = 0;
    ctx.ipc.on('audio', (chunk) => { samples += chunk.length; });

    // Push events to the renderer half (api.ipc.on('tick'))
    const timer = setInterval(() => ctx.ipc.send('tick', { at: Date.now(), samples }), 1000);
    ctx.onStop(() => clearInterval(timer));
  },

  // Optional: runs when the mod is turned off, reloaded or the app quits
  stop() {},
};
