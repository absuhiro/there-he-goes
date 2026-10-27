// Isolated-world bridge: settings + popup/shortcut commands <-> page script (inject.js).
(() => {
  const DEFAULTS = { enabled: true, sensitivity: 6, duration: 2.5, direction: 'right', aiFill: true, vSign: false, autoPhoto: true };
  let settings = Object.assign({}, DEFAULTS);
  document.documentElement.setAttribute('data-thg-ext', chrome.runtime.id);

  const toPage = (type, data) => window.postMessage({ thg: true, from: 'content', type, data }, '*');

  let photoUrl = null;
  chrome.storage.local.get('roomPhoto').then((r) => { photoUrl = r.roomPhoto ? r.roomPhoto.url : null; if (photoUrl) toPage('photo', { url: photoUrl }); });
  chrome.storage.sync.get(DEFAULTS).then((s) => { settings = s; toPage('settings', settings); });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'sync') return;
    for (const k in changes) settings[k] = changes[k].newValue;
    toPage('settings', settings);
  });

  window.addEventListener('message', (e) => {
    const m = e.data;
    if (e.source !== window || !m || m.thg !== true || m.from !== 'page') return;
    if (m.type === 'hello') { toPage('settings', settings); if (photoUrl) toPage('photo', { url: photoUrl }); }
    if (m.type === 'photo-captured') { photoUrl = m.data.url; chrome.storage.local.set({ roomPhoto: { url: photoUrl, ts: Date.now() } }).catch(() => {}); }
    if (m.type === 'spawn') spawnEngine(m.data);
    if (m.type === 'kill') { const f = frames.get(m.data); if (f) { f.remove(); frames.delete(m.data); } }
    if (m.type === 'status') {
      chrome.storage.local.set({ status: Object.assign({}, m.data, { ts: Date.now(), host: location.hostname }) }).catch(() => {});
    }
  });

  // The engine lives in an extension-owned iframe. We create it from here (the extension's own
  // context) and pass a private MessagePort to both the engine and the page script.
  const frames = new Map();
  function spawnEngine(d) {
    const f = document.createElement('iframe');
    f.src = chrome.runtime.getURL('engine.html');
    f.style.cssText = 'position:fixed;left:-10000px;top:0;width:8px;height:8px;border:0;opacity:0;pointer-events:none';
    f.setAttribute('aria-hidden', 'true'); f.tabIndex = -1;
    f.addEventListener('error', () => toPage('engine-error', { iid: d.iid, msg: 'iframe failed to load engine.html' }));
    f.addEventListener('load', () => {
      const ch = new MessageChannel();
      f.contentWindow.postMessage({ thg: 'hello', W: d.W, H: d.H, hasAudio: d.hasAudio }, '*', [ch.port2]);
      window.postMessage({ thg: true, from: 'content', type: 'port', data: d.iid }, '*', [ch.port1]);
    });
    frames.set(d.iid, f);
    document.documentElement.appendChild(f);
  }

  window.addEventListener('message', (e) => {
    const m = e.data;
    if (!m || (m.thg !== 'engine-error' && m.thg !== 'engine-boot')) return;
    for (const [iid, f] of frames) if (f.contentWindow === e.source) toPage(m.thg, { iid, msg: m.msg });
  });

  chrome.runtime.onMessage.addListener((msg) => {
    if (!msg) return;
    if (msg.type === 'snap-now') toPage('snap-now');
    if (msg.type === 'relearn') toPage('relearn');
    if (msg.type === 'capture-room') toPage('capture-room');
    if (msg.type === 'clear-room') { photoUrl = null; chrome.storage.local.remove('roomPhoto'); toPage('photo', { url: null }); }
  });
})();
