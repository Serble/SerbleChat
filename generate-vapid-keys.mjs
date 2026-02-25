/**
 * Generates a VAPID key pair for Web Push notifications.
 * Run with: node generate-vapid-keys.mjs
 *
 * Requires Node 15+ (built-in Web Crypto API).
 * Copy the output into appsettings.json under "PushNotifications".
 */

const { subtle } = globalThis.crypto;

const keyPair = await subtle.generateKey(
  { name: 'ECDH', namedCurve: 'P-256' },
  true,
  ['deriveKey', 'deriveBits']
);

function toBase64Url(buffer) {
  return Buffer.from(buffer)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

const publicKeyRaw  = await subtle.exportKey('raw',  keyPair.publicKey);
const privateKeyPkcs = await subtle.exportKey('pkcs8', keyPair.privateKey);

// The VAPID private key is the raw 32-byte scalar, which sits at bytes 36–68 in the PKCS#8 envelope.
const privateKeyRaw = new Uint8Array(privateKeyPkcs).slice(36, 68);

const publicKey  = toBase64Url(publicKeyRaw);
const privateKey = toBase64Url(privateKeyRaw);

console.log('\n✅ Generated VAPID key pair:\n');
console.log(`  Public Key:  ${publicKey}`);
console.log(`  Private Key: ${privateKey}`);
console.log('\nPaste into appsettings.Development.json:');
console.log(JSON.stringify({
  PushNotifications: {
    VapidPublicKey:  publicKey,
    VapidPrivateKey: privateKey,
    Subject: 'mailto:admin@serble.net'
  }
}, null, 2));
console.log();
