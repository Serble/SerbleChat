// electron-builder hook, run after packaging. Without an Apple Developer certificate the Mac build
// isn't signed at all, but packaging changes the app and breaks the signature Electron ships with,
// and macOS refuses to run arm64 apps whose signature is broken ("is damaged"). An ad-hoc signature
// fixes that; people still have to allow the app once, as with any app from outside the App Store.
const { execFileSync } = require('node:child_process');
const path = require('node:path');

exports.default = async function adhocSign(context) {
  if (context.electronPlatformName !== 'darwin') return;
  const app = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`);
  console.log(`  • ad-hoc signing ${app}`);
  execFileSync('codesign', ['--force', '--deep', '--sign', '-', app], { stdio: 'inherit' });
};
