# Privacy

There he goes processes your camera and microphone **locally in your browser**.

- No video, audio, images or settings are sent to any server by this extension. It has no analytics, no accounts and no remote code.
- The only network access is the one-time `node setup.mjs` model download (from jsDelivr, Google Cloud Storage and Hugging Face). After that the extension works offline.
- The microphone is used to hear the click of a snap and to pass your voice through to the call. A second, unprocessed copy of the mic is analysed in memory only to detect that click; nothing is recorded.
- Your settings are stored with `chrome.storage.sync` (Chrome may sync these through your Google account, like any extension's settings).
- If you capture an empty-room photo, it is stored in `chrome.storage.local` on this computer only. Use **Clear** in the popup to delete it.
- The meeting site itself still receives the processed video and audio, because that is the point of the extension.
