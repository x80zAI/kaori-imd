import { createRequire } from 'node:module';
import { mkdirSync, copyFileSync, writeFileSync, statSync } from 'node:fs';
const require = createRequire(import.meta.url);
const sharp = require('C:/Users/User/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/sharp');
const originals = 'C:/Users/User/.codex/generated_images/01a10114-e4ad-7852-b178-7cfca64dfbdb/';
const avatar = originals + 'exec-a2fa88ce-2115-4a1a-a628-062877d4e5fb.png';
const scene = originals + 'exec-d428a0de-4e80-4d67-bc2a-23621030e462.png';
const banner = originals + 'exec-6a509c3a-98bd-4b6d-8ad3-999571cff091.png';
mkdirSync('public/brand', { recursive: true });
mkdirSync('artifacts/brand', { recursive: true });
const outputs = [
  [avatar, 'public/brand/kaori-avatar.png', 512, 512],
  [avatar, 'artifacts/brand/kaori-logo-1024.png', 1024, 1024],
  [avatar, 'artifacts/brand/kaori-avatar-400.png', 400, 400],
  [banner, 'public/brand/kaori-banner.png', 1500, 500],
  [scene, 'public/brand/kaori-scene.png', 1536, 1024]
];
const report = [];
for (const [source, target, width, height] of outputs) {
  await sharp(source).resize(width, height, { fit: 'fill', kernel: 'nearest' }).flatten({ background: '#171b2c' }).png({ compressionLevel: 9 }).toFile(target);
  const meta = await sharp(target).metadata();
  if (meta.width !== width || meta.height !== height || meta.hasAlpha) throw new Error('Invalid image export: ' + target);
  report.push({ target, width, height, bytes: statSync(target).size });
}
copyFileSync('public/brand/kaori-banner.png', 'artifacts/brand/kaori-banner-1500x500.png');
writeFileSync('artifacts/brand/export-verification.json', JSON.stringify(report, null, 2));
console.log(JSON.stringify(report));
