// There he goes — engine. Runs inside an extension-owned iframe so the meeting page's
// security policy can't block the models. Everything here is local; no network access.
const tell = (thg, msg) => { try { window.parent.postMessage({ thg, msg: String(msg) }, '*'); } catch (e) {} };
window.addEventListener('error', (e) => tell('engine-error', (e.message || 'error') + ' @ ' + String(e.filename || '').split('/').pop() + ':' + e.lineno));
window.addEventListener('unhandledrejection', (e) => tell('engine-error', 'promise: ' + ((e.reason && e.reason.message) || e.reason)));
tell('engine-boot', 'started');
const BASE = new URL('./', location.href).href;
const S = { enabled: true, sensitivity: 6, duration: 2.5, direction: 'right', aiFill: true, vSign: false, autoPhoto: true };
let port = null, W = 0, H = 0, N = 0, hasAudio = false;
let handLM = null, seg = null, ready = false, curBmp = null, frameNo = 0;
const t0 = performance.now();
const tsCounters = { hand: 0, seg: 0 };
const nextTs = (k) => (tsCounters[k] = Math.max(tsCounters[k] + 1, Math.floor(performance.now())));
const post = (m, tr) => { if (port) { try { port.postMessage(m, tr || []); } catch (e) {} } };
let photoLocked = false, pendingPhoto = null, cap = null, personFrac = 0, absentN = 0; const gain = [1, 1, 1];
const status = { hands: 0, pinch: 0, clicks: 0, state: 'loading', msg: '', coverage: 0, ai: 'off', mode: 'visible', lastHandAt: 0, lastClickAt: 0, lastFireAt: 0 };

// ---------- messaging ----------
window.addEventListener('message', (e) => {
  if (port || e.source !== window.parent) return;
  const d = e.data;
  if (!d || d.thg !== 'hello' || !e.ports[0]) return;
  port = e.ports[0]; W = d.W; H = d.H; N = W * H; hasAudio = !!d.hasAudio;
  port.onmessage = (ev) => onMessage(ev.data);
  post({ type: 'alive' });
  start();
});

function onMessage(m) {
  switch (m.type) {
    case 'frame': onFrame(m.bmp, m.t); break;
    case 'settings':
      Object.assign(S, m.s);
      if (!S.enabled && mode !== 'visible') forceVisible();
      if (S.aiFill && !lamaW && ready) initLama();
      break;
    case 'snapNow': if (ready && S.enabled) fire('manual', true); break;
    case 'click': onClick(m.t); break;
    case 'relearn': resetPlate(); break;
    case 'capture': startCapture(); break;
    case 'photo-load': if (N) applyPhotoUrl(m.url); else pendingPhoto = m.url; break;
    case 'photo-clear': photoLocked = false; gain[0] = gain[1] = gain[2] = 1; resetPlate(); break;
  }
}

// ---------- canvases & buffers ----------
const mk = (w, h, rf) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return [c, c.getContext('2d', { willReadFrequently: !!rf })]; };
let outC, o, fcC, fcx, plC, plx, bodyC, bodyx, partC, partx, mfC, mfx, mdC, mdx, segC, segx, SW, SH;
let known, cnt, candL, learned, fill, lamaFilled, holeW, fillMask, lamaMask, dispImg, knownCount = 0, lastQF = -1;
let maskSmall, maskSx, maskImg, ema = null, invert = false, polarityLocked = false, maskOK = false;

function alloc() {
  outC = new OffscreenCanvas(W, H); o = outC.getContext('2d');
  [fcC, fcx] = mk(W, H, true); [plC, plx] = mk(W, H); [bodyC, bodyx] = mk(W, H); [partC, partx] = mk(W, H);
  [mfC, mfx] = mk(W, H, true); [mdC, mdx] = mk(W, H, true);
  SW = 256; SH = Math.max(144, Math.round((256 * H) / W)); [segC, segx] = mk(SW, SH);
  known = new Uint8Array(N); cnt = new Uint8Array(N); lamaFilled = new Uint8Array(N); holeW = new Uint8Array(N); fillMask = new Uint8Array(N); candL = new Uint8Array(N);
  learned = new Float32Array(N * 3); fill = new Uint8ClampedArray(N * 3).fill(120);
  dispImg = new ImageData(W, H);
  partImg = new ImageData(W, H);
}
let partImg;

// ---------- startup ----------
async function start() {
  alloc();
  if (pendingPhoto) { applyPhotoUrl(pendingPhoto); pendingPhoto = null; }
  try {
    let vision;
    try { vision = await import('./lib/vision_bundle.mjs'); }
    catch (e) { throw Object.assign(new Error('Model files are missing. Run setup.mjs (see README).'), { code: 'missing' }); }
    const fileset = await vision.FilesetResolver.forVisionTasks(BASE + 'lib/wasm');
    const make = async (Cls, file, extra) => {
      for (const delegate of ['GPU', 'CPU']) {
        try { return await Cls.createFromOptions(fileset, Object.assign({ baseOptions: { modelAssetPath: BASE + 'models/' + file, delegate }, runningMode: 'VIDEO' }, extra)); }
        catch (e) { if (delegate === 'CPU') throw e; }
      }
    };
    try {
      handLM = await make(vision.HandLandmarker, 'hand_landmarker.task', { numHands: 2, minHandDetectionConfidence: 0.4, minHandPresenceConfidence: 0.4, minTrackingConfidence: 0.4 });
      seg = await make(vision.ImageSegmenter, 'selfie_segmenter.tflite', { outputConfidenceMasks: true, outputCategoryMask: false });
    } catch (e) { throw Object.assign(new Error('Could not load models: ' + (e.message || e)), { code: /fetch|404|load/i.test(String(e.message)) ? 'missing' : 'error' }); }
    ready = true; status.state = 'ready';
    post({ type: 'ready' });
    setTimeout(() => { if (S.aiFill) initLama(); }, 3000);
  } catch (e) {
    status.state = e.code || 'error'; status.msg = e.message; tell('engine-error', e.message);
    post({ type: 'error', code: status.state, msg: e.message, fatal: true });
  }
  setInterval(report, 1000);
}
function report() {
  status.coverage = N ? knownCount / N : 0; status.mode = mode;
  post({ type: 'status', data: Object.assign({ hidden: mode === 'hidden' || mode === 'hiding', photo: photoLocked }, status) });
}

// ---------- per-frame ----------
function onFrame(bmp, tCap) {
  frameNo++; curBmp = bmp;
  let outBmp = bmp;
  try {
    if (ready && S.enabled) {
      detectHands(bmp, tCap);
      if (frameNo % 2 === 0) runSeg(bmp);
      if (cap) captureStep(bmp);
      checkPending();
      if (wantEffect) { wantEffect = false; if (mode === 'visible' || mode === 'hidden') startEffect(mode === 'hidden'); }
      if (frameNo % (mode === 'visible' ? 3 : 6) === 0) { fcx.drawImage(bmp, 0, 0); updatePlate(); }
      if (frameNo % 45 === 0) maybeQuickFill();
      maybeLama();
      advanceMode();
      if (mode !== 'visible') { outBmp = compose(bmp); bmp.close(); }
    }
  } catch (err) { console.error('[There he goes]', err); }
  curBmp = null;
  post({ type: 'out', bmp: outBmp }, [outBmp]);
}

// ---------- segmentation ----------
function runSeg(bmp) {
  segx.drawImage(bmp, 0, 0, SW, SH);
  const r = seg.segmentForVideo(segC, nextTs('seg'));
  const ms = r && r.confidenceMasks;
  if (!ms || !ms.length) return;
  const m = ms.length > 1 ? ms[1] : ms[0];
  const arr = m.getAsFloat32Array(), w = m.width, h = m.height;
  if (!ema || ema.length !== w * h) {
    ema = new Float32Array(w * h); [maskSmall, maskSx] = mk(w, h);
    maskImg = maskSx.createImageData(w, h); maskImg.data.fill(255);
  }
  if (!polarityLocked) { // figure out whether the model's "1" means person (centre vs. side strips)
    let c = 0, cn = 0, b = 0, bn = 0;
    for (let y = (h * 0.3) | 0; y < h * 0.9; y += 2) {
      for (let x = (w * 0.35) | 0; x < w * 0.65; x += 2) { c += arr[y * w + x]; cn++; }
      for (let x = 0; x < w * 0.08; x += 2) { b += arr[y * w + x] + arr[y * w + w - 1 - x]; bn += 2; }
    }
    c /= cn; b /= bn;
    if (Math.abs(c - b) > 0.4) { invert = c < b; polarityLocked = true; }
  }
  const d = maskImg.data;
  let pc = 0;
  for (let i = 0; i < arr.length; i++) {
    const v = invert ? 1 - arr[i] : arr[i];
    const e = (ema[i] = ema[i] * 0.5 + v * 0.5);
    const t = Math.min(1, Math.max(0, (e - 0.35) / 0.4));
    d[i * 4 + 3] = (t * t * (3 - 2 * t) * 255) | 0;
    if (d[i * 4 + 3] > 128) pc++;
  }
  personFrac = pc / arr.length;
  maskSx.putImageData(maskImg, 0, 0);
  mfx.clearRect(0, 0, W, H); mfx.filter = 'blur(2px)'; mfx.drawImage(maskSmall, 0, 0, W, H); mfx.filter = 'none';
  mdx.clearRect(0, 0, W, H); mdx.filter = 'blur(12px)'; mdx.drawImage(maskSmall, 0, 0, W, H); mdx.filter = 'none';
  ms.forEach((x) => x.close && x.close());
  maskOK = true;
  autoPhotoStep();
}

// ---------- background plate ----------
function resetPlate() {
  if (photoLocked) return; // a captured room photo is the truth; use Clear to remove it
  known.fill(0); cnt.fill(0); candL.fill(0); lamaFilled.fill(0); holeW.fill(0); fillMask.fill(0); fill.fill(120); knownCount = 0; lastQF = -1; lamaRan = false;
  if (S.aiFill && lamaReady) status.ai = 'ready';
}
function updatePlate() {
  if (!maskOK) return;
  const fd = fcx.getImageData(0, 0, W, H).data;
  const md = mdx.getImageData(0, 0, W, H).data;
  const L = learned;
  if (photoLocked || mode !== 'visible') {
    // Frozen: never learn from frames that contain you (your shadow would leak in). Only match brightness.
    const sl = [0, 0, 0], sp = [0, 0, 0];
    for (let i = 0; i < N; i += 5) if (known[i] && md[i * 4 + 3] < 10) for (let c = 0; c < 3; c++) { sl[c] += fd[i * 4 + c]; sp[c] += L[i * 3 + c]; }
    for (let c = 0; c < 3; c++) if (sp[c] > 0) gain[c] += (Math.min(1.5, Math.max(0.67, sl[c] / sp[c])) - gain[c]) * 0.25;
  } else {
    gain[0] = gain[1] = gain[2] = 1;
    let kc = knownCount;
    for (let i = 0, p = 0, q = 0; i < N; i++, p += 4, q += 3) {
      if (md[p + 3] < 10) { // clearly background, away from you and your halo
        if (known[i]) {
          // only slow lighting drift is followed; a moving hand or object (big change) is ignored, and
          // darkening is slower than brightening so a cast shadow doesn't become "the room"
          const dr = fd[p] - L[q], dg = fd[p + 1] - L[q + 1], db = fd[p + 2] - L[q + 2];
          if (Math.abs(dr) < 18 && Math.abs(dg) < 18 && Math.abs(db) < 18) {
            L[q] += dr * (dr < 0 ? 0.004 : 0.03); L[q + 1] += dg * (dg < 0 ? 0.004 : 0.03); L[q + 2] += db * (db < 0 ? 0.004 : 0.03);
          }
        } else {
          const lum = (fd[p] * 3 + fd[p + 1] * 4 + fd[p + 2]) >> 3; // must hold still for ~5 updates before it is trusted
          if (Math.abs(lum - candL[i]) > 14) { candL[i] = lum; cnt[i] = 0; }
          else if (++cnt[i] >= 5) { known[i] = 1; kc++; L[q] = fd[p]; L[q + 1] = fd[p + 1]; L[q + 2] = fd[p + 2]; }
        }
      } else cnt[i] = 0;
    }
    knownCount = kc;
  }
  writeDisplay();
}
function writeDisplay() {
  const D = dispImg.data, L = learned, F = fill, g0 = gain[0], g1 = gain[1], g2 = gain[2];
  for (let i = 0, p = 0, q = 0; i < N; i++, p += 4, q += 3) {
    let r, g, b;
    if (known[i]) {
      r = L[q]; g = L[q + 1]; b = L[q + 2];
      const w = holeW[i];
      if (w > 8) { const a = w / 255; r += (F[q] - r) * a; g += (F[q + 1] - g) * a; b += (F[q + 2] - b) * a; } // feather the seam
    } else { r = F[q]; g = F[q + 1]; b = F[q + 2]; }
    D[p] = r * g0; D[p + 1] = g * g1; D[p + 2] = b * g2; D[p + 3] = 255;
  }
  plx.putImageData(dispImg, 0, 0);
}
// Your body also casts a soft shadow on the wall behind you, just OUTSIDE the cut-out. That shadowed wall
// must not be kept as "the room", so the area to re-create is the hole grown by ~60 px.
function buildFillMask() {
  const [c, cx] = mk(W, H), [, cx2] = mk(W, H, true), im = new ImageData(W, H);
  for (let i = 0; i < N; i++) if (!known[i]) { const p = i * 4; im.data[p] = im.data[p + 1] = im.data[p + 2] = im.data[p + 3] = 255; }
  let tex = 0, tn = 0; // how detailed is the known room? (mean luminance change over 2 px)
  for (let y = 0; y < H; y += 4) for (let x = 0; x < W - 3; x += 4) {
    const i = y * W + x, j = i + 2;
    if (known[i] && known[j]) { tex += Math.abs((learned[i * 3] * 3 + learned[i * 3 + 1] * 4 + learned[i * 3 + 2]) - (learned[j * 3] * 3 + learned[j * 3 + 1] * 4 + learned[j * 3 + 2])) / 8; tn++; }
  }
  status.texture = tn ? Math.round((tex / tn) * 10) / 10 : 0;
  const plain = status.texture < 4;
  cx.putImageData(im, 0, 0); cx2.filter = plain ? 'blur(30px)' : 'blur(5px)'; cx2.drawImage(c, 0, 0);
  const d = cx2.getImageData(0, 0, W, H).data, m = new Uint8Array(N);
  for (let i = 0; i < N; i++) m[i] = !known[i] || d[i * 4 + 3] > 10 ? 1 : 0;
  return m;
}
function applyFeather(m) {
  const [c, cx] = mk(W, H), [, cx2] = mk(W, H, true), im = new ImageData(W, H);
  for (let i = 0; i < N; i++) if (m[i]) { const p = i * 4; im.data[p] = im.data[p + 1] = im.data[p + 2] = im.data[p + 3] = 255; }
  cx.putImageData(im, 0, 0); cx2.filter = 'blur(8px)'; cx2.drawImage(c, 0, 0);
  const d = cx2.getImageData(0, 0, W, H).data;
  fillMask = m;
  for (let i = 0; i < N; i++) holeW[i] = m[i] ? 255 : d[i * 4 + 3];
}

// ---------- captured room photo ----------
function finishPhoto(save) {
  known.fill(1); knownCount = N; lamaFilled.fill(0); holeW.fill(0); fillMask.fill(0); cnt.fill(0); candL.fill(0); fill.fill(120); lastQF = N; photoLocked = true; lamaRan = true;
  gain[0] = gain[1] = gain[2] = 1;
  writeDisplay();
  if (save) post({ type: 'photo-result', ok: true, url: plC.toDataURL('image/jpeg', 0.88) });
}
// First time you step out of frame (no person, no hands for ~1.7 s) the empty room is photographed automatically.
function autoPhotoStep() {
  if (!S.autoPhoto || photoLocked || cap || mode !== 'visible') { absentN = 0; return; }
  if (personFrac < 0.004 && status.hands === 0) absentN++; else absentN = 0;
  if (absentN >= 25) { absentN = 0; startCapture(); }
}
function startCapture() {
  if (!ready || !maskOK) { post({ type: 'photo-result', ok: false, msg: 'Still starting up. Try again in a few seconds.' }); return; }
  cap = { n: 0, sum: new Float32Array(N * 3) };
}
function captureStep(bmp) {
  fcx.drawImage(bmp, 0, 0);
  const fd = fcx.getImageData(0, 0, W, H).data;
  if (cap.n === 0) { // refuse if somebody is still in view
    const mf = mfx.getImageData(0, 0, W, H).data; let c = 0;
    for (let i = 3; i < mf.length; i += 16) if (mf[i] > 100) c++;
    if (c > (N / 4) * 0.01) { cap = null; post({ type: 'photo-result', ok: false, msg: 'Someone is still in the frame. Step fully out of view and try again.' }); return; }
  }
  const sum = cap.sum;
  for (let i = 0, p = 0, q = 0; i < N; i++, p += 4, q += 3) { sum[q] += fd[p]; sum[q + 1] += fd[p + 1]; sum[q + 2] += fd[p + 2]; }
  if (++cap.n >= 8) { for (let i = 0; i < N * 3; i++) learned[i] = sum[i] / 8; cap = null; finishPhoto(true); }
}
function applyPhotoUrl(url) {
  const img = new Image();
  img.onload = () => {
    const [, cx] = mk(W, H, true), c = cx.canvas, k = Math.max(W / img.width, H / img.height), dw = img.width * k, dh = img.height * k;
    cx.drawImage(img, (W - dw) / 2, (H - dh) / 2, dw, dh);
    const d = cx.getImageData(0, 0, W, H).data;
    for (let i = 0; i < N; i++) { learned[i * 3] = d[i * 4]; learned[i * 3 + 1] = d[i * 4 + 1]; learned[i * 3 + 2] = d[i * 4 + 2]; }
    finishPhoto(false);
  };
  img.src = url;
}

// Fast fallback fill (push-pull diffusion at 1/4 resolution + sensor-like grain).
function maybeQuickFill() {
  if (photoLocked || !maskOK || knownCount >= N * 0.995) return;
  if (lastQF >= 0 && Math.abs(knownCount - lastQF) < N * 0.005) return;
  lastQF = knownCount;
  applyFeather(buildFillMask());
  const lw = W >> 2, lh = H >> 2;
  let c = new Float32Array(lw * lh * 3), wt = new Float32Array(lw * lh);
  for (let y = 0; y < lh; y++) for (let x = 0; x < lw; x++) {
    let n = 0, r = 0, g = 0, b = 0;
    for (let yy = 0; yy < 4; yy++) {
      let i = (y * 4 + yy) * W + x * 4;
      for (let xx = 0; xx < 4; xx++, i++) if (known[i] && !fillMask[i]) { n++; r += learned[i * 3]; g += learned[i * 3 + 1]; b += learned[i * 3 + 2]; }
    }
    if (n) { const j = y * lw + x; wt[j] = n / 16; c[j * 3] = r / n; c[j * 3 + 1] = g / n; c[j * 3 + 2] = b / n; }
  }
  const lv = [{ w: lw, h: lh, c, wt }];
  for (let cur = lv[0]; cur.w > 2 && cur.h > 2; cur = lv[lv.length - 1]) {
    const nw = cur.w >> 1, nh = cur.h >> 1, nc = new Float32Array(nw * nh * 3), nwt = new Float32Array(nw * nh);
    for (let y = 0; y < nh; y++) for (let x = 0; x < nw; x++) {
      let sw = 0, r = 0, g = 0, b = 0;
      for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) {
        const j = (y * 2 + dy) * cur.w + x * 2 + dx, w = cur.wt[j];
        sw += w; r += cur.c[j * 3] * w; g += cur.c[j * 3 + 1] * w; b += cur.c[j * 3 + 2] * w;
      }
      const k = y * nw + x;
      if (sw > 0) { nc[k * 3] = r / sw; nc[k * 3 + 1] = g / sw; nc[k * 3 + 2] = b / sw; nwt[k] = Math.min(1, sw / 2); }
    }
    lv.push({ w: nw, h: nh, c: nc, wt: nwt });
  }
  const top = lv[lv.length - 1]; let ar = 0, ag = 0, ab = 0, an = 0;
  for (let j = 0; j < top.wt.length; j++) if (top.wt[j] > 0) { ar += top.c[j * 3]; ag += top.c[j * 3 + 1]; ab += top.c[j * 3 + 2]; an++; }
  if (!an) { ar = ag = ab = 120; an = 1; }
  for (let j = 0; j < top.wt.length; j++) if (top.wt[j] <= 0) { top.c[j * 3] = ar / an; top.c[j * 3 + 1] = ag / an; top.c[j * 3 + 2] = ab / an; top.wt[j] = 1; }
  const samp = (L, fx, fy, ch) => {
    fx = Math.min(L.w - 1, Math.max(0, fx)); fy = Math.min(L.h - 1, Math.max(0, fy));
    const x0 = fx | 0, y0 = fy | 0, x1 = Math.min(L.w - 1, x0 + 1), y1 = Math.min(L.h - 1, y0 + 1), ax = fx - x0, ay = fy - y0;
    const a = L.c[(y0 * L.w + x0) * 3 + ch], b = L.c[(y0 * L.w + x1) * 3 + ch], c2 = L.c[(y1 * L.w + x0) * 3 + ch], d = L.c[(y1 * L.w + x1) * 3 + ch];
    return a + (b - a) * ax + (c2 - a) * ay + (a - b - c2 + d) * ax * ay;
  };
  for (let l = lv.length - 2; l >= 0; l--) {
    const L = lv[l], P = lv[l + 1];
    for (let y = 0; y < L.h; y++) for (let x = 0; x < L.w; x++) {
      const j = y * L.w + x, t = L.wt[j];
      if (t >= 1) continue;
      const fx = (x + 0.5) / 2 - 0.5, fy = (y + 0.5) / 2 - 0.5;
      for (let ch = 0; ch < 3; ch++) L.c[j * 3 + ch] = L.c[j * 3 + ch] * t + samp(P, fx, fy, ch) * (1 - t);
      L.wt[j] = 1;
    }
  }
  const base = lv[0];
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x;
    if ((!fillMask[i] && holeW[i] < 8) || lamaFilled[i]) continue;
    const fx = (x + 0.5) / 4 - 0.5, fy = (y + 0.5) / 4 - 0.5, g = (Math.random() - 0.5) * 5;
    fill[i * 3] = samp(base, fx, fy, 0) + g; fill[i * 3 + 1] = samp(base, fx, fy, 1) + g; fill[i * 3 + 2] = samp(base, fx, fy, 2) + g;
  }
}

// ---------- AI inpainting (LaMa, optional) ----------
let lamaW = null, lamaReady = false, lamaBusy = false, lamaRan = false;
async function initLama() {
  if (lamaW) return;
  try { const r = await fetch(BASE + 'models/lama_fp32.onnx', { method: 'HEAD' }); if (!r.ok) throw 0; }
  catch (e) { status.ai = 'missing'; return; }
  status.ai = 'loading';
  lamaW = new Worker('lama-worker.js');
  lamaW.onerror = () => { status.ai = 'error'; lamaBusy = false; };
  lamaW.onmessage = (e) => {
    const m = e.data;
    if (m.type === 'ready') { lamaReady = true; status.ai = 'ready'; }
    else if (m.type === 'error') { console.warn('[There he goes] AI fill:', m.error); status.ai = 'error'; lamaBusy = false; }
    else if (m.type === 'result') applyLama(m.rgba);
  };
  lamaW.postMessage({ type: 'init', modelUrl: BASE + 'models/lama_fp32.onnx' });
}
function maybeLama() {
  if (photoLocked || !S.aiFill || !lamaReady || lamaBusy || lamaRan || mode !== 'visible' || !maskOK) return;
  if (performance.now() - t0 < 8000 || 1 - knownCount / N < 0.01) return;
  runLama();
}
function runLama() {
  if (photoLocked) return;
  lamaBusy = true; status.ai = 'working';
  lamaMask = buildFillMask();
  const R = 512, RR = R * R;
  const [a, ax] = mk(W, H);
  const img = new ImageData(W, H), hole = new ImageData(W, H);
  for (let i = 0, p = 0, q = 0; i < N; i++, p += 4, q += 3) {
    if (!lamaMask[i]) { img.data[p] = learned[q]; img.data[p + 1] = learned[q + 1]; img.data[p + 2] = learned[q + 2]; }
    else { hole.data[p] = hole.data[p + 1] = hole.data[p + 2] = 255; hole.data[p + 3] = 255; }
    img.data[p + 3] = 255;
  }
  ax.putImageData(img, 0, 0);
  const [, bx] = mk(R, R, true);
  bx.imageSmoothingQuality = 'high'; bx.drawImage(a, 0, 0, R, R);
  const id = bx.getImageData(0, 0, R, R).data, image = new Float32Array(3 * RR);
  for (let i = 0; i < RR; i++) { image[i] = id[i * 4] / 255; image[RR + i] = id[i * 4 + 1] / 255; image[2 * RR + i] = id[i * 4 + 2] / 255; }
  ax.clearRect(0, 0, W, H); ax.putImageData(hole, 0, 0);
  bx.clearRect(0, 0, R, R); bx.filter = 'blur(5px)'; bx.drawImage(a, 0, 0, R, R); bx.filter = 'none';
  const md = bx.getImageData(0, 0, R, R).data, mask = new Float32Array(RR);
  for (let i = 0; i < RR; i++) mask[i] = md[i * 4 + 3] > 24 ? 1 : 0;
  lamaW.postMessage({ type: 'run', image, mask }, [image.buffer, mask.buffer]);
}
function applyLama(rgba) {
  if (photoLocked) { lamaBusy = false; return; } // a photo was set while the AI was thinking: the photo wins
  const [c, cx] = mk(512, 512); cx.putImageData(new ImageData(rgba, 512, 512), 0, 0);
  const [, dx] = mk(W, H, true); dx.drawImage(c, 0, 0, W, H);
  const d = dx.getImageData(0, 0, W, H).data;
  applyFeather(lamaMask);
  for (let i = 0; i < N; i++) if (fillMask[i] || holeW[i] >= 8) { fill[i * 3] = d[i * 4]; fill[i * 3 + 1] = d[i * 4 + 1]; fill[i * 3 + 2] = d[i * 4 + 2]; if (fillMask[i]) lamaFilled[i] = 1; }
  lamaBusy = false; lamaRan = true; status.ai = 'ready';
}

// ---------- gesture detection ----------
// A snap = a deliberate thumb+middle pinch (held >= 3 frames), then the release, AND a click from the mic
// at the same moment. A click alone, or a hand pose alone, never triggers anything.
const hist = new Map(), clicks = [];
let pending = null, cooldown = 0;
const dist = (a, b) => Math.hypot((a.x - b.x) * W, (a.y - b.y) * H);
const thr = () => ({ arm: 0.26 + 0.02 * S.sensitivity }); // sensitivity 6 -> pinch ratio < 0.38

function detectHands(bmp, tCap) {
  let res;
  try { res = handLM.detectForVideo(bmp, nextTs('hand')); } catch (e) { return; }
  status.hands = (res.landmarks || []).length;
  if (Date.now() < cooldown) { hist.clear(); return; } // lockout after every snap: nothing is tracked
  const seen = new Set(), th = thr(), handed = res.handedness || res.handednesses || [];
  (res.landmarks || []).forEach((lm, i) => {
    const key = (handed[i] && handed[i][0] && handed[i][0].categoryName) || 'h' + i;
    seen.add(key);
    const size = dist(lm[0], lm[9]);
    if (size < W * 0.025) return;
    let h = hist.get(key);
    if (!h) hist.set(key, (h = { armedN: 0, armedT: 0, last: 9, vStart: 0, vDone: false, lost: 0 }));
    h.lost = 0;
    const pinch = dist(lm[4], lm[12]) / size;
    h.last = pinch; status.pinch = Math.round(pinch * 100) / 100;
    if (pinch < th.arm) { h.armedN++; h.armedT = tCap; }
    else if (pinch > th.arm + 0.25) { if (h.armedN >= 3 && tCap - h.armedT < 250) release(tCap); h.armedN = 0; }
    else if (tCap - h.armedT > 250) h.armedN = 0;
    if (S.vSign) { // optional second gesture: hold a V (peace) sign for 0.7 s
      const ext = (t, p) => dist(lm[t], lm[0]) > dist(lm[p], lm[0]) * 1.12, cur = (t, p) => dist(lm[t], lm[0]) < dist(lm[p], lm[0]) * 1.02;
      if (ext(8, 6) && ext(12, 10) && cur(16, 14) && cur(20, 18) && dist(lm[8], lm[12]) / size > 0.35) {
        if (!h.vStart) h.vStart = tCap; else if (!h.vDone && tCap - h.vStart >= 700) { h.vDone = true; status.lastHandAt = Date.now(); fire('v-sign'); }
      } else { h.vStart = 0; h.vDone = false; }
    }
  });
  for (const [k, h] of hist) {
    if (seen.has(k)) continue;
    h.lost++;
    if (h.lost === 1 && h.armedN >= 3 && h.last < th.arm + 0.12 && S.sensitivity >= 6) { h.armedN = 0; release(Date.now()); } // hand blurred out mid-snap
    if (h.lost > 6) hist.delete(k);
  }
}
function release(t) {
  status.lastHandAt = Date.now();
  if (!hasAudio) { if (S.sensitivity >= 4) fire('hand'); return; }
  if (clicks.some((c) => c >= t - 300 && c <= t + 350)) fire('hand+click');
  else pending = { t, exp: Date.now() + 350 };
}
function onClick(t) {
  clicks.push(t); if (clicks.length > 12) clicks.shift();
  status.lastClickAt = Date.now(); status.clicks++;
  if (Date.now() < cooldown) return;
  if (pending && Math.abs(t - pending.t) <= 350) { pending = null; fire('click+hand'); }
}
function checkPending() { if (pending && Date.now() > pending.exp) pending = null; }
function fire(why, force) {
  const now = Date.now();
  if (!force && now < cooldown) return;
  if (mode !== 'visible' && mode !== 'hidden') return;
  cooldown = now + Math.max(1200, S.duration * 1000 + 1500); // covers the whole animation plus a settle time
  status.lastFireAt = now;
  hist.clear(); clicks.length = 0; pending = null;
  wantEffect = true; // started on the next frame, when we have a frame in hand
}
let wantEffect = false;

// ---------- the dust effect ----------
let mode = 'visible', animStart = 0, animDur = 2500, fx = null;
const DIRS = { right: [1, -0.18], left: [-1, -0.18], up: [0, -1], down: [0, 1] };
const ASH = [196, 176, 150];
function forceVisible() { mode = 'visible'; fx = null; post({ type: 'state', hidden: false, mode }); }

const lat = new Float32Array(65536);
function vn(x, y) {
  const xi = Math.floor(x), yi = Math.floor(y), fx_ = x - xi, fy = y - yi;
  const sx = fx_ * fx_ * (3 - 2 * fx_), sy = fy * fy * (3 - 2 * fy);
  const i = xi & 255, j = yi & 255, i1 = (i + 1) & 255, j1 = (j + 1) & 255;
  const a = lat[j * 256 + i], b = lat[j * 256 + i1], c = lat[j1 * 256 + i], d = lat[j1 * 256 + i1];
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
}

function startEffect(show) {
  const hiding = !show;
  fcx.drawImage(curBmp, 0, 0);
  const fd = fcx.getImageData(0, 0, W, H).data, mf = mfx.getImageData(0, 0, W, H).data;
  let minX = W, minY = H, maxX = 0, maxY = 0, area = 0;
  for (let y = 0; y < H; y += 2) for (let x = 0; x < W; x += 2) {
    if (mf[(y * W + x) * 4 + 3] > 140) { area++; if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y; }
  }
  if (!maskOK || area < 60) { mode = hiding ? 'hidden' : 'visible'; post({ type: 'state', hidden: hiding, mode }); return; }

  for (let i = 0; i < lat.length; i++) lat[i] = Math.random();
  const bw = maxX - minX + 1, bh = maxY - minY + 1, cx = (minX + maxX) / 2, cy = (minY + maxY) / 2, sc = W / 960;
  const burst = S.direction === 'burst';
  let ux = 1, uy = 0;
  if (!burst) { const d = DIRS[S.direction] || DIRS.right, l = Math.hypot(d[0], d[1]); ux = d[0] / l; uy = d[1] / l; }
  const dots = [minX * ux + minY * uy, maxX * ux + minY * uy, minX * ux + maxY * uy, maxX * ux + maxY * uy];
  const dMin = Math.min(...dots), dMax = Math.max(...dots), dRange = Math.max(1, dMax - dMin);

  // dissolve-order field at half resolution: 0 = goes first (downwind side + ragged noise), 1 = goes last
  const w2 = W >> 1, h2 = H >> 1, O = new Float32Array(w2 * h2);
  let oMin = 9, oMax = -9;
  const x2a = minX >> 1, x2b = maxX >> 1, y2a = minY >> 1, y2b = maxY >> 1;
  for (let y = 0; y < h2; y++) for (let x = 0; x < w2; x++) {
    const n = vn(x * 0.03, y * 0.03) * 0.5 + vn(x * 0.09 + 7, y * 0.09 + 3) * 0.3 + vn(x * 0.27 + 1, y * 0.27 + 9) * 0.2;
    const proj = 1 - (x * 2 * ux + y * 2 * uy - dMin) / dRange;
    const v = burst ? n : 0.58 * proj + 0.42 * n;
    O[y * w2 + x] = v;
    if (x >= x2a && x <= x2b && y >= y2a && y <= y2b) { if (v < oMin) oMin = v; if (v > oMax) oMax = v; }
  }
  const oR = Math.max(1e-3, oMax - oMin);
  // every pixel (also the soft fringe outside the body's bounding box) gets a dissolve time, so nothing is left behind
  for (let i = 0; i < O.length; i++) O[i] = Math.min(1, Math.max(0, (O[i] - oMin) / oR));

  const P = Math.min(14000, Math.max(3000, ((area * 4) / 45) | 0));
  const f32 = () => new Float32Array(P);
  const p = { P, PX: f32(), PY: f32(), PR: f32(), PG: f32(), PB: f32(), DEL: f32(), LIFE: f32(), DX: f32(), DY: f32(), AMP: f32(), WOB: f32(), WAV: f32(), PH: f32(), RISE: f32(), SZ: new Uint8Array(P) };
  for (let k = 0, tries = 0; k < P && tries < P * 15; tries++) {
    const x = (minX + Math.random() * bw) | 0, y = (minY + Math.random() * bh) | 0, i = y * W + x;
    if (mf[i * 4 + 3] < 150) continue;
    p.PX[k] = x; p.PY[k] = y; p.PR[k] = fd[i * 4]; p.PG[k] = fd[i * 4 + 1]; p.PB[k] = fd[i * 4 + 2];
    p.DEL[k] = O[(y >> 1) * w2 + (x >> 1)] * 0.55 + Math.random() * 0.03;
    p.LIFE[k] = 0.4 + Math.random() * 0.04;
    const ang = (burst ? Math.atan2(y - cy, x - cx) : Math.atan2(uy, ux)) + (Math.random() - 0.5) * (burst ? 0.8 : 0.9);
    p.DX[k] = Math.cos(ang); p.DY[k] = Math.sin(ang);
    p.AMP[k] = (burst ? 180 + Math.random() * 320 : 260 + Math.random() * 420) * sc;
    p.WOB[k] = (20 + Math.random() * 70) * sc; p.WAV[k] = 3 + Math.random() * 6; p.PH[k] = Math.random() * 6.28;
    p.RISE[k] = (10 + Math.random() * 60) * sc; p.SZ[k] = Math.max(1, Math.round((1.2 + Math.random() * 1.8) * sc));
    k++;
  }
  fx = { p, O, w2, h2, erC: null };
  [fx.erC, fx.erx] = mk(w2, h2); fx.erImg = fx.erx.createImageData(w2, h2); fx.erImg.data.fill(255);
  animDur = Math.max(800, S.duration * 1000); animStart = performance.now();
  mode = hiding ? 'hiding' : 'showing';
  post({ type: 'state', hidden: hiding, mode }); // mic mutes/unmutes at the same instant
}

function advanceMode() {
  if (mode !== 'hiding' && mode !== 'showing') return;
  if ((performance.now() - animStart) / animDur < 1.02) return;
  const wasHiding = mode === 'hiding';
  mode = wasHiding ? 'hidden' : 'visible'; fx = null;
  post({ type: 'state', hidden: wasHiding, mode });
}

function compose(bmp) {
  o.globalCompositeOperation = 'source-over';
  o.drawImage(plC, 0, 0);
  if (fx && (mode === 'hiding' || mode === 'showing')) {
    const raw = (performance.now() - animStart) / animDur;
    const f = mode === 'hiding' ? raw : 1.02 - raw;
    // erode the live body with the dissolve-order field
    const t = Math.min(1.15, Math.max(0, f) / 0.55), ed = fx.erImg.data, O = fx.O;
    for (let i = 0; i < O.length; i++) { const a = (O[i] - t) * 14; ed[i * 4 + 3] = a <= 0 ? 0 : a >= 1 ? 255 : (a * 255) | 0; }
    fx.erx.putImageData(fx.erImg, 0, 0);
    bodyx.globalCompositeOperation = 'source-over'; bodyx.clearRect(0, 0, W, H);
    bodyx.drawImage(bmp, 0, 0, W, H);
    bodyx.globalCompositeOperation = 'destination-in';
    bodyx.drawImage(mfC, 0, 0); bodyx.drawImage(fx.erC, 0, 0, W, H);
    bodyx.globalCompositeOperation = 'source-over';
    o.drawImage(bodyC, 0, 0);
    drawParticles(f);
    o.drawImage(partC, 0, 0);
  }
  return outC.transferToImageBitmap();
}

function drawParticles(f) {
  const p = fx.p, pd = partImg.data;
  pd.fill(0);
  for (let k = 0; k < p.P; k++) {
    const s = (f - p.DEL[k]) / p.LIFE[k];
    if (s <= 0 || s >= 1) continue;
    const travel = p.AMP[k] * (s * (0.35 + 0.65 * s)), wob = Math.sin(s * p.WAV[k] + p.PH[k]) * p.WOB[k] * s;
    const x = (p.PX[k] + p.DX[k] * travel - p.DY[k] * wob) | 0, y = (p.PY[k] + p.DY[k] * travel + p.DX[k] * wob - p.RISE[k] * s * s) | 0;
    const m = Math.min(1, 0.2 + 0.6 * s), a = ((1 - s * s) * 255) | 0;
    const r = p.PR[k] * (1 - m) + ASH[0] * m, g = p.PG[k] * (1 - m) + ASH[1] * m, b = p.PB[k] * (1 - m) + ASH[2] * m, sz = p.SZ[k];
    for (let yy = 0; yy < sz; yy++) {
      const yv = y + yy; if (yv < 0 || yv >= H) continue;
      for (let xx = 0; xx < sz; xx++) {
        const xv = x + xx; if (xv < 0 || xv >= W) continue;
        const i = (yv * W + xv) * 4; pd[i] = r; pd[i + 1] = g; pd[i + 2] = b; pd[i + 3] = a;
      }
    }
  }
  partx.putImageData(partImg, 0, 0);
}
