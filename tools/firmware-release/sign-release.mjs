// Sign an OpenApiary firmware release and emit the manifest the Worker enforces.
//
//   node sign-release.mjs --version v1.1.0 --zip openapiary-v1.1.0.zip \
//        --uf2 openapiary-v1.1.0.uf2 [--key firmware-signing-key.pem] \
//        [--notes "What changed"] [--out manifest.json]
//
// Produces manifest.json with, for the DFU .zip: size, sha256, and a detached
// Ed25519 signature over the raw .zip bytes (base64). Upload all three files
// (.zip, .uf2, manifest.json) as assets on the private GitHub release. The
// Worker verifies sha256 + signature against the pinned public key before it
// ever streams the image to a scale; the app re-checks sha256 for integrity.
//
// Full release flow:
//   1. pio run -e xiaoble                      # build production firmware
//   2. adafruit-nrfutil dfu genpkg \           # Nordic DFU package (.zip)
//        --dev-type 0x0052 \
//        --application .pio/build/xiaoble/firmware.hex \
//        openapiary-<ver>.zip
//   3. uf2conv .pio/build/xiaoble/firmware.hex \# USB recovery image (.uf2)
//        -c -f 0xADA52840 -o openapiary-<ver>.uf2
//   4. node sign-release.mjs --version <ver> --zip …zip --uf2 …uf2
//   5. Create the GitHub release <ver> and attach: .zip, .uf2, manifest.json

import { readFileSync, writeFileSync } from 'node:fs';
import { createHash, createPrivateKey, sign } from 'node:crypto';
import { basename } from 'node:path';

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : fallback;
}

const version = arg('version');
const zipPath = arg('zip');
const uf2Path = arg('uf2');
const keyPath = arg('key', 'firmware-signing-key.pem');
const notes = arg('notes', '');
const outPath = arg('out', 'manifest.json');

if (!version || !zipPath) {
  console.error('Usage: node sign-release.mjs --version vX.Y.Z --zip pkg.zip [--uf2 pkg.uf2] [--key key.pem] [--notes "..."] [--out manifest.json]');
  process.exit(1);
}

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');

const zip = readFileSync(zipPath);
const privateKey = createPrivateKey(readFileSync(keyPath));
// Ed25519 is a pure signature scheme — pass null as the (unused) digest algo.
const sig = sign(null, zip, privateKey).toString('base64');

const manifest = {
  version,
  notes,
  createdAt: Date.now(),
  zip: { name: basename(zipPath), size: zip.length, sha256: sha256(zip), sig },
};

if (uf2Path) {
  const uf2 = readFileSync(uf2Path);
  manifest.uf2 = { name: basename(uf2Path), size: uf2.length, sha256: sha256(uf2) };
}

writeFileSync(outPath, JSON.stringify(manifest, null, 2));
console.log(`Wrote ${outPath}`);
console.log(`  version : ${version}`);
console.log(`  zip     : ${manifest.zip.name} (${zip.length} bytes)`);
console.log(`  sha256  : ${manifest.zip.sha256}`);
console.log(`  sig     : ${sig.slice(0, 24)}…`);
if (manifest.uf2) console.log(`  uf2     : ${manifest.uf2.name} (${manifest.uf2.size} bytes)`);
