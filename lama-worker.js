// Runs the optional LaMa inpainting model off the main thread (single-threaded WASM, fully local).
importScripts('lib/ort.min.js');
ort.env.wasm.wasmPaths = new URL('lib/', self.location.href).href;
ort.env.wasm.numThreads = 1;
let session = null;
const R = 512, RR = R * R;

self.onmessage = async (e) => {
  const m = e.data;
  try {
    if (m.type === 'init') {
      session = await ort.InferenceSession.create(m.modelUrl, { executionProviders: ['wasm'], graphOptimizationLevel: 'basic' });
      self.postMessage({ type: 'ready' });
    } else if (m.type === 'run') {
      const names = session.inputNames;
      const imgName = names.includes('image') ? 'image' : names[0];
      const maskName = names.includes('mask') ? 'mask' : names[1];
      const feeds = {};
      feeds[imgName] = new ort.Tensor('float32', m.image, [1, 3, R, R]);
      feeds[maskName] = new ort.Tensor('float32', m.mask, [1, 1, R, R]);
      const out = await session.run(feeds);
      const d = out[session.outputNames[0]].data;
      let max = 0;
      for (let i = 0; i < d.length; i += 97) if (d[i] > max) max = d[i];
      const k = max <= 2 ? 255 : 1; // some exports return 0..1, others 0..255
      const rgba = new Uint8ClampedArray(RR * 4);
      for (let i = 0; i < RR; i++) {
        rgba[i * 4] = d[i] * k; rgba[i * 4 + 1] = d[RR + i] * k; rgba[i * 4 + 2] = d[2 * RR + i] * k; rgba[i * 4 + 3] = 255;
      }
      self.postMessage({ type: 'result', rgba }, [rgba.buffer]);
    }
  } catch (err) {
    self.postMessage({ type: 'error', error: String(err && err.message || err) });
  }
};
