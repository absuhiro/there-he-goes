// One-time download of the model files (needs Node 18+). After this the extension is fully offline.
//   node setup.mjs            -> everything, including the optional ~210 MB AI room-fill model
//   node setup.mjs --no-lama  -> skip the AI room-fill model (a simpler built-in fill is used)
import { mkdir, rename, stat } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const MP = '0.10.14', ORT = '1.17.3';
const mp = (p) => `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MP}/${p}`;
const ort = (p) => `https://cdn.jsdelivr.net/npm/onnxruntime-web@${ORT}/dist/${p}`;

const files = [
  [mp('vision_bundle.mjs'), 'lib/vision_bundle.mjs'],
  [mp('wasm/vision_wasm_internal.js'), 'lib/wasm/vision_wasm_internal.js'],
  [mp('wasm/vision_wasm_internal.wasm'), 'lib/wasm/vision_wasm_internal.wasm'],
  [mp('wasm/vision_wasm_nosimd_internal.js'), 'lib/wasm/vision_wasm_nosimd_internal.js'],
  [mp('wasm/vision_wasm_nosimd_internal.wasm'), 'lib/wasm/vision_wasm_nosimd_internal.wasm'],
  ['https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task', 'models/hand_landmarker.task'],
  ['https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter/float16/latest/selfie_segmenter.tflite', 'models/selfie_segmenter.tflite'],
];
if (!process.argv.includes('--no-lama')) {
  files.push(
    [ort('ort.min.js'), 'lib/ort.min.js'],
    [ort('ort-wasm.wasm'), 'lib/ort-wasm.wasm'],
    [ort('ort-wasm-simd.wasm'), 'lib/ort-wasm-simd.wasm'],
    ['https://huggingface.co/Carve/LaMa-ONNX/resolve/main/lama_fp32.onnx', 'models/lama_fp32.onnx'],
  );
}

const exists = async (p) => { try { return (await stat(p)).size > 0; } catch { return false; } };
let failed = 0;
for (const [url, rel] of files) {
  const dest = join(root, rel);
  if (await exists(dest)) { console.log('have   ', rel); continue; }
  await mkdir(dirname(dest), { recursive: true });
  process.stdout.write(`fetch   ${rel} ... `);
  try {
    const res = await fetch(url, { redirect: 'follow' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    await pipeline(Readable.fromWeb(res.body), createWriteStream(dest + '.part'));
    await rename(dest + '.part', dest);
    console.log('done');
  } catch (e) { failed++; console.log('FAILED (' + e.message + ')\n        ' + url); }
}
console.log(failed ? `\n${failed} file(s) failed. Re-run the script, or download the URLs above by hand into the same paths.` : '\nAll set. Now load the folder in chrome://extensions (Developer mode > Load unpacked).');
process.exit(failed ? 1 : 0);
