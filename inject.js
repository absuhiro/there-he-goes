// There he goes — page-world script.
// Wraps getUserMedia: the page receives a canvas video track (processed by the local engine
// iframe) and a gated audio track. Nothing is uploaded anywhere.
(() => {
  'use strict';
  if (window.__thgInstalled) return;
  window.__thgInstalled = true;

  const MAX_W = 960;   // processing width. Lower to 640 if your machine struggles.
  const FPS = 30;
  let settings = { enabled: true, sensitivity: 6, duration: 2.5, direction: 'right', aiFill: true, vSign: false, autoPhoto: true };
  const instances = new Set();
  let roomPhoto = null;

  const toContent = (type, data) => window.postMessage({ thg: true, from: 'page', type, data }, '*');
  window.addEventListener('message', (e) => {
    const m = e.data;
    if (e.source !== window || !m || m.thg !== true || m.from !== 'content') return;
    if (m.type === 'settings') { settings = Object.assign({}, settings, m.data); instances.forEach((i) => i.sendSettings()); }
    else if (m.type === 'snap-now') {
      if (!instances.size) badge('no camera is hooked on this page yet. Turn your camera off and on (or rejoin the call) with the extension enabled.', true);
      instances.forEach((i) => { if (!i.ready) badge('not ready yet (' + (i.stage || 'starting') + ').', true); i.send({ type: 'snapNow' }); });
    }
    else if (m.type === 'relearn') instances.forEach((i) => i.send({ type: 'relearn' }));
    else if (m.type === 'photo') {
      roomPhoto = (m.data && m.data.url) || null;
      instances.forEach((i) => i.send(roomPhoto ? { type: 'photo-load', url: roomPhoto } : { type: 'photo-clear' }));
    }
    else if (m.type === 'capture-room') {
      const inst = [...instances][0];
      if (!inst) { badge('no camera is hooked yet. Turn your camera on first.', true); return; }
      if (!inst.ready) { badge('not ready yet (' + (inst.stage || 'starting') + ').', true); return; }
      let n = 5;
      const step = () => {
        if (n > 0) { badge('Step fully out of the frame. Capturing the empty room in ' + n + '…', false, true); n--; setTimeout(step, 1000); }
        else { badge('Capturing, hold still…', false, true); inst.send({ type: 'capture' }); }
      };
      step();
    }
    else if (m.type === 'engine-boot' || m.type === 'engine-error') {
      for (const i of instances) if (i.iid === m.data.iid) {
        if (m.type === 'engine-boot') i.booted = true;
        else { i.lastErr = m.data.msg; badge('engine page error: ' + m.data.msg, true, true); }
      }
    }
    else if (m.type === 'port' && e.ports[0]) {
      for (const i of instances) if (i.iid === m.data) { i.gotPort = true; i.port = e.ports[0]; i.port.onmessage = (ev) => i.onEngine(ev.data); i.sendSettings(); if (roomPhoto) i.send({ type: 'photo-load', url: roomPhoto }); }
    }
  });
  toContent('hello');

  // Tiny on-page diagnostic badge so you can see which stage is working.
  let badgeEl = null, badgeTimer = null;
  function badge(text, bad, keep) {
    console.log('[There he goes]', text);
    if (!badgeEl) {
      badgeEl = document.createElement('div');
      badgeEl.style.cssText = 'position:fixed;left:12px;bottom:12px;z-index:2147483647;font:12px/1.4 system-ui,sans-serif;padding:7px 10px;border-radius:8px;color:#efe6d8;background:#2b2433;border:1px solid #e0a64a;max-width:340px;pointer-events:none';
    }
    badgeEl.textContent = 'There he goes: ' + text;
    badgeEl.style.borderColor = bad ? '#ff8a73' : '#e0a64a';
    (document.body || document.documentElement).appendChild(badgeEl);
    clearTimeout(badgeTimer);
    if (!keep) badgeTimer = setTimeout(() => badgeEl && badgeEl.remove(), bad ? 12000 : 7000);
  }

  const proto = window.MediaDevices && window.MediaDevices.prototype;
  if (!proto || !proto.getUserMedia) return;
  const origGUM = proto.getUserMedia;

  proto.getUserMedia = async function (constraints) {
    const real = await origGUM.call(this, constraints);
    if (!settings.enabled) { console.log('[There he goes] disabled in popup, normal camera used'); return real; }
    if (!constraints || !constraints.video || !real.getVideoTracks().length) return real;
    badge('camera hooked, starting engine…');
    let inst = null;
    try {
      inst = new Instance(real, this);
      await inst.init();
      return inst.stream;
    } catch (err) {
      console.warn('[There he goes] falling back to the normal camera:', err);
      badge('setup failed: ' + (err && err.message || err), true);
      if (inst) inst.abort();
      return real;
    }
  };

  class Instance {
    constructor(real, md) {
      this.real = real; this.md = md;
      this.ready = false; this.busy = false; this.busySince = 0; this.mode = 'visible';
      this.videoStopped = false; this.audioStopped = false; this.audioDetect = false;
      this.port = null; this.gain = null; this.ac = null; this.rawStream = null;
      this.vt = real.getVideoTracks()[0];
      const st = this.vt.getSettings();
      const sw = st.width || 1280, sh = st.height || 720, k = Math.min(1, MAX_W / sw);
      this.W = Math.max(2, Math.round((sw * k) / 2) * 2);
      this.H = Math.max(2, Math.round((sh * k) / 2) * 2);
    }

    async init() {
      const v = (this.video = document.createElement('video'));
      v.muted = true; v.playsInline = true; v.autoplay = true;
      v.style.cssText = 'position:fixed;left:-10000px;top:0;width:2px;height:2px;opacity:0;pointer-events:none';
      v.srcObject = new MediaStream([this.vt]);
      document.documentElement.appendChild(v);
      await Promise.race([v.play().catch(() => {}), new Promise((r) => setTimeout(r, 1500))]);

      const c = (this.canvas = document.createElement('canvas'));
      c.width = this.W; c.height = this.H;
      this.ctx = c.getContext('2d');
      this.ctx.drawImage(v, 0, 0, this.W, this.H);
      this.vOut = c.captureStream(FPS).getVideoTracks()[0];
      this.patchVideoTrack();

      await this.setupAudio();
      const tracks = [this.vOut];
      if (this.aOut) tracks.push(this.aOut);
      this.stream = new MediaStream(tracks);

      instances.add(this);
      this.startEngine();
      this.timer = setInterval(() => this.tick(), 1000 / FPS);
      this.statusTimer = setTimeout(() => {
        if (!this.alive && !this.videoStopped) toContent('status', { state: 'blocked', msg: 'The page blocked the extension engine.' }); badge('no reply from engine.html. Steps reached: content script ' + (this.gotPort ? 'ok' : 'NOT responding (reload the extension and refresh the tab)') + ', engine script ' + (this.booted ? 'started' : 'NOT started') + (this.lastErr ? ', error: ' + this.lastErr : '') + '.', true, true);
      }, 10000);
    }

    patchVideoTrack() {
      const t = this.vOut, vt = this.vt, self = this, stop = t.stop.bind(t);
      t.stop = function () { stop(); self.stopVideo(); };
      try { Object.defineProperty(t, 'label', { get: () => vt.label }); } catch (e) {}
      const gs = t.getSettings.bind(t);
      t.getSettings = () => Object.assign({}, gs(), { deviceId: vt.getSettings().deviceId, width: self.W, height: self.H, frameRate: FPS });
      t.applyConstraints = async () => {};
    }

    async setupAudio() {
      const at = this.real.getAudioTracks()[0];
      if (!at) return;
      this.aOut = at; // fallback: the real track, muted via .enabled
      try {
        const AC = window.AudioContext || window.webkitAudioContext;
        const ac = new AC({ latencyHint: 'interactive' });
        await Promise.race([ac.resume(), new Promise((r) => setTimeout(r, 800))]);
        if (ac.state !== 'running') { ac.close(); return; }
        const src = ac.createMediaStreamSource(new MediaStream([at]));
        const gain = ac.createGain();
        const dest = ac.createMediaStreamDestination();
        src.connect(gain); gain.connect(dest);
        this.ac = ac; this.gain = gain;
        this.aOut = dest.stream.getAudioTracks()[0];
        try { Object.defineProperty(this.aOut, 'label', { get: () => at.label }); } catch (e) {}
        const self = this, stop = this.aOut.stop.bind(this.aOut);
        this.aOut.stop = function () { stop(); self.stopAudio(); };
        await this.startClickDetector(ac, at);
      } catch (err) {
        console.warn('[There he goes] audio gate unavailable, using fallback mute:', err);
      }
    }

    // Raw (unprocessed) mic copy, used ONLY to hear the snap's click. Never sent anywhere.
    async startClickDetector(ac, at) {
      try {
        const did = at.getSettings().deviceId;
        this.rawStream = await origGUM.call(this.md, {
          audio: { deviceId: did ? { exact: did } : undefined, echoCancellation: false, noiseSuppression: false, autoGainControl: false },
        });
      } catch (e) { this.rawStream = null; }
      const src = ac.createMediaStreamSource(this.rawStream || new MediaStream([at]));
      const sp = ac.createScriptProcessor(512, 1, 1);
      const sink = ac.createGain(); sink.gain.value = 0;
      src.connect(sp); sp.connect(sink); sink.connect(ac.destination);
      let bg = 1e-6, prev = 0, last = 0;
      sp.onaudioprocess = (ev) => {
        const x = ev.inputBuffer.getChannelData(0);
        let e = 0, tot = 0, p = prev;
        for (let i = 0; i < x.length; i++) { const d = x[i] - p; e += d * d; tot += x[i] * x[i]; p = x[i]; }
        prev = p; e /= x.length; tot /= x.length;
        const sharp = e / (tot + 1e-9); // clicks are broadband (high), voice and hum are not (low)
        const k = 7 - settings.sensitivity * 0.45;           // sensitivity 1..10 -> 6.5x .. 2.5x over baseline
        const now = performance.now();
        if (e > bg * k && e > 1.5e-5 && sharp > 0.5 && now - last > 150) {
          last = now;
          this.send({ type: 'click', t: Date.now() - 8 });
        }
        bg = Math.max(1e-8, bg + (Math.min(e, bg * 3) - bg) * 0.02);
      };
      this.audioDetect = true;
    }

    startEngine() {
      this.iid = Math.random().toString(36).slice(2);
      toContent('spawn', { iid: this.iid, W: this.W, H: this.H, hasAudio: this.audioDetect });
    }

    send(m) { if (this.port) { try { this.port.postMessage(m); } catch (e) {} } }
    sendSettings() { this.send({ type: 'settings', s: settings }); }

    onEngine(m) {
      switch (m.type) {
        case 'alive': this.alive = true; this.stage = 'engine loaded, loading models'; badge('engine loaded, loading models…', false, true); break;
        case 'ready': this.ready = true; this.stage = 'ready'; badge(roomPhoto ? 'ready. Snap!' : 'ready. Tip: step out of the frame for 3 seconds and your empty room is photographed automatically.'); break;
        case 'out':
          if (!this.videoStopped) this.ctx.drawImage(m.bmp, 0, 0);
          m.bmp.close(); this.busy = false; break;
        case 'photo-result':
          if (m.ok) { roomPhoto = m.url; toContent('photo-captured', { url: m.url }); badge('Room photo saved. When you turn to dust, the call will see it. (Wrong? Clear it in the popup.)'); }
          else badge(m.msg, true);
          break;
        case 'state':
          if (m.mode === 'hiding' && !roomPhoto) badge('Tip: capture an empty-room photo (popup) for a perfectly clean room.');
          this.mode = m.mode; this.setHidden(m.hidden); break;
        case 'status': toContent('status', m.data); break;
        case 'error':
          toContent('status', { state: m.code || 'error', msg: m.msg });
          badge(m.code === 'missing' ? 'model files missing. Run setup.mjs, then reload the extension.' : 'engine error: ' + m.msg, true);
          if (m.fatal) this.ready = false;
          break;
      }
    }

    setHidden(h) {
      if (this.gain) this.gain.gain.setTargetAtTime(h ? 0 : 1, this.ac.currentTime, 0.01);
      else if (this.aOut) this.aOut.enabled = !h;
    }

    tick() {
      if (this.videoStopped) return;
      if (this.vOut.readyState === 'ended') { this.stopVideo(); return; }
      const v = this.video;
      if (v.readyState < 2) return;
      if (this.ac && this.ac.state === 'suspended') this.ac.resume().catch(() => {});
      const now = performance.now();
      if (!this.ready) { this.ctx.drawImage(v, 0, 0, this.W, this.H); return; }
      if (this.busy && now - this.busySince > 4000) this.busy = false;
      if (!this.busy) {
        this.busy = true; this.busySince = now;
        const t = Date.now();
        createImageBitmap(v, { resizeWidth: this.W, resizeHeight: this.H, resizeQuality: 'low' })
          .then((b) => { if (this.videoStopped || !this.port) { b.close(); this.busy = false; return; } this.port.postMessage({ type: 'frame', bmp: b, t }, [b]); })
          .catch(() => { this.busy = false; });
      } else if (now - this.busySince > 1200 && this.mode === 'visible') {
        this.ctx.drawImage(v, 0, 0, this.W, this.H); // engine stalled while you are visible: don't freeze the call
      } // if you are dust and the engine stalls, the last empty-room frame is held on purpose
    }

    stopVideo() {
      if (this.videoStopped) return;
      this.videoStopped = true;
      clearInterval(this.timer); clearTimeout(this.statusTimer);
      if (!this.keepReal) { try { this.vt.stop(); } catch (e) {} }
      this.setHidden(false);                 // camera off => mic back to normal
      try { if (this.port) this.port.close(); } catch (e) {}
      toContent('kill', this.iid);
      if (this.video) { this.video.srcObject = null; this.video.remove(); }
      instances.delete(this);
    }

    stopAudio() {
      if (this.audioStopped) return;
      this.audioStopped = true;
      this.real.getAudioTracks().forEach((t) => t.stop());
      if (this.rawStream) this.rawStream.getTracks().forEach((t) => t.stop());
      if (this.ac) this.ac.close().catch(() => {});
    }

    // Setup failed: release our pieces but leave the real camera/mic tracks alone for the page.
    abort() {
      this.keepReal = true; this.stopVideo();
      if (this.rawStream) this.rawStream.getTracks().forEach((t) => t.stop());
      if (this.ac) this.ac.close().catch(() => {});
    }
  }
})();
