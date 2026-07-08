// Ed25519 key generator for OpenApiary firmware signing.
//
//   node keygen.mjs
//
// Writes the PRIVATE key to firmware-signing-key.pem (keep OFFLINE — never
// commit it; anyone with it can sign firmware the fleet will accept) and prints
// the PUBLIC key as 32-byte hex. Paste that hex into:
//   * cloud/api/wrangler.toml  -> FIRMWARE_PUBLIC_KEY (both env blocks)
// The Worker enforces this signature before streaming firmware to any scale.

import { generateKeyPairSync } from 'node:crypto';
import { writeFileSync, existsSync } from 'node:fs';

const KEY_PATH = 'firmware-signing-key.pem';
if (existsSync(KEY_PATH)) {
  console.error(`Refusing to overwrite existing ${KEY_PATH}. Move it aside first.`);
  process.exit(1);
}

const { publicKey, privateKey } = generateKeyPairSync('ed25519');
// The raw 32-byte public key is the tail of the SPKI DER encoding.
const pubHex = Buffer.from(publicKey.export({ type: 'spki', format: 'der' }).subarray(-32)).toString('hex');

writeFileSync(KEY_PATH, privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 });

console.log(`Private key written to ${KEY_PATH} — KEEP OFFLINE, do NOT commit.`);
console.log('');
console.log('Public key (hex) — set as FIRMWARE_PUBLIC_KEY in cloud/api/wrangler.toml:');
console.log(pubHex);
