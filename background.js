// Keyboard shortcut (backup for the on-camera snap): forwards to the active tab.
chrome.commands.onCommand.addListener(async (command) => {
  if (command !== 'snap-now') return;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab && tab.id != null) chrome.tabs.sendMessage(tab.id, { type: 'snap-now' }).catch(() => {});
});
