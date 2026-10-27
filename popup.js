const DEFAULTS = { enabled: true, sensitivity: 6, duration: 2.5, direction: 'right', aiFill: true, vSign: false, autoPhoto: true };
const $ = (id) => document.getElementById(id);
const sendToTab = async (msg) => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab && tab.id != null) chrome.tabs.sendMessage(tab.id, msg).catch(() => {});
};

async function init() {
  const s = await chrome.storage.sync.get(DEFAULTS);
  $('enabled').checked = s.enabled; $('aiFill').checked = s.aiFill; $('vSign').checked = s.vSign; $('autoPhoto').checked = s.autoPhoto; $('direction').value = s.direction;
  $('sensitivity').value = s.sensitivity; $('duration').value = s.duration;
  const label = () => { $('o-sens').textContent = $('sensitivity').value + ' / 10'; $('o-dur').textContent = Number($('duration').value).toFixed(1) + ' s'; };
  label();
  const save = (k, v) => chrome.storage.sync.set({ [k]: v });
  $('enabled').onchange = (e) => save('enabled', e.target.checked);
  $('autoPhoto').onchange = (e) => save('autoPhoto', e.target.checked);
  $('vSign').onchange = (e) => save('vSign', e.target.checked);
  $('aiFill').onchange = (e) => save('aiFill', e.target.checked);
  $('direction').onchange = (e) => save('direction', e.target.value);
  $('sensitivity').oninput = (e) => { label(); save('sensitivity', Number(e.target.value)); };
  $('duration').oninput = (e) => { label(); save('duration', Number(e.target.value)); };
  $('snap').onclick = () => sendToTab({ type: 'snap-now' });
  $('relearn').onclick = () => sendToTab({ type: 'relearn' });
  $('capture').onclick = async () => { await sendToTab({ type: 'capture-room' }); window.close(); };
  $('clearroom').onclick = async () => { await sendToTab({ type: 'clear-room' }); await chrome.storage.local.remove('roomPhoto'); refresh(); };

  const cmds = await chrome.commands.getAll();
  const c = cmds.find((x) => x.name === 'snap-now');
  $('kbd').textContent = c && c.shortcut ? c.shortcut : 'no shortcut set';
  refresh(); setInterval(refresh, 1000);
}

const ago = (t) => (t ? Math.max(0, Math.round((Date.now() - t) / 1000)) + 's ago' : 'not yet');

async function refresh() {
  const el = $('status');
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const { status, roomPhoto } = await chrome.storage.local.get(['status', 'roomPhoto']);
  $('thumb').hidden = !roomPhoto; if (roomPhoto) $('thumb').src = roomPhoto.url;
  let host = ''; try { host = new URL(tab.url).hostname; } catch (e) {}
  el.className = '';
  if (!status || Date.now() - status.ts > 4000 || status.host !== host) {
    el.textContent = 'Not running on this tab. Join a call on Meet, Teams or Zoom and turn your camera on.';
    return;
  }
  if (status.state === 'loading') { el.textContent = 'Loading the models…'; return; }
  if (status.state === 'missing') { el.className = 'bad'; el.textContent = 'Model files are missing. Run setup.mjs once (see README), then reload the extension.'; return; }
  if (status.state === 'blocked') { el.className = 'bad'; el.textContent = 'This page blocked the extension engine. Your normal camera is used.'; return; }
  if (status.state === 'error') { el.className = 'bad'; el.textContent = status.msg || 'Something went wrong. Your normal camera is used.'; return; }
  const ai = { ready: 'ready', working: 'working…', loading: 'loading…', off: 'off', missing: 'not installed', error: 'failed' }[status.ai] || status.ai;
  const state = status.mode === 'hidden' ? 'You are dust.' : status.mode === 'hiding' || status.mode === 'showing' ? 'Snapping…' : 'Watching for a snap.';
  el.className = 'ok';
  el.textContent = state + (status.photo ? ' Using your room photo.' : '') + ' Room learned ' + Math.round(status.coverage * 100) + '%, AI fill ' + ai +
    '. Hands in view: ' + (status.hands || 0) + ' (pinch ' + (status.pinch || 0) + '), clicks heard: ' + (status.clicks || 0) + '. Last click '  + ago(status.lastClickAt) + ', last hand snap seen ' + ago(status.lastHandAt) + '.';
}
init();
