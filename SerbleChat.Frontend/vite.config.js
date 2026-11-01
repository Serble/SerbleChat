import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * Serves /.well-known/assetlinks.json, which lets the Android app open invite and message links
 * without asking (Android App Links). Android fetches it from this site's host and checks the
 * app's signing certificate against the fingerprints listed here.
 *
 * VITE_ANDROID_CERT_FINGERPRINTS: comma-separated SHA-256 fingerprints of the signing
 * certificates ("AB:CD:..."), from `keytool -list -v -keystore <keystore>` or Play Console's
 * App signing page. VITE_ANDROID_PACKAGES: comma-separated package names, default net.serble.chat.
 * With no fingerprints the file isn't written, and Android falls back to asking which app to use.
 */
function androidAssetLinks(env) {
  const fingerprints = (env.VITE_ANDROID_CERT_FINGERPRINTS ?? '')
    .split(',').map(f => f.trim().toUpperCase()).filter(Boolean);
  const packages = (env.VITE_ANDROID_PACKAGES || 'net.serble.chat')
    .split(',').map(p => p.trim()).filter(Boolean);
  const bad = fingerprints.filter(f => !/^([0-9A-F]{2}:){31}[0-9A-F]{2}$/.test(f));
  if (bad.length) throw new Error(`VITE_ANDROID_CERT_FINGERPRINTS has malformed SHA-256 fingerprints: ${bad.join(', ')}`);

  const json = JSON.stringify(packages.map(pkg => ({
    relation: ['delegate_permission/common.handle_all_urls'],
    target: { namespace: 'android_app', package_name: pkg, sha256_cert_fingerprints: fingerprints },
  })), null, 2);

  return {
    name: 'android-asset-links',
    configureServer(server) {
      if (!fingerprints.length) return;
      server.middlewares.use('/.well-known/assetlinks.json', (req, res) => {
        res.setHeader('Content-Type', 'application/json');
        res.end(json);
      });
    },
    generateBundle() {
      if (!fingerprints.length) return;
      this.emitFile({ type: 'asset', fileName: '.well-known/assetlinks.json', source: json });
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd());
  return {
    plugins: [react(), ...(mode === 'electron' ? [] : [androidAssetLinks(env)])],
    // Electron loads dist/index.html over file://, so it needs relative asset paths.
    // The web build must use absolute paths, otherwise deep links like /app/channel/1
    // resolve assets to /app/channel/assets/... and get the SPA fallback HTML instead.
    base: mode === 'electron' ? './' : '/',
    server: {
      port: 5173,
    },
    build: {
      outDir: 'dist',
      emptyOutDir: true,
    },
  };
});
