# There he goes

A Chrome extension for Google Meet, Microsoft Teams and Zoom (web). Snap your fingers on camera and you turn to dust and blow away like the Endgame snap. The call sees an empty room, and your mic mutes. Snap again and you pour back in and unmute.

Everything runs inside your browser. No video or audio is sent anywhere by this extension (see [PRIVACY.md](PRIVACY.md)).

> Status: early. It has not been verified on every site or machine. Teams and Zoom are less tested than Meet.

## Install

1. **Get the models once** (needs Node.js 18+). In this folder:

       node setup.mjs

   Downloads about 230 MB into `lib/` and `models/`. Add `--no-lama` to skip the 210 MB optional AI room-fill model.
2. Open `chrome://extensions`, turn on **Developer mode**, click **Load unpacked**, choose this folder.
3. Join a call, **turn your camera on**, wait for the "Ready" badge in the bottom-left, then snap.

After installing or updating, reload the extension, refresh the call tab, and toggle your camera off and on.

## Use

- **Snap on camera.** Pinch thumb and middle finger, hold for a beat, and snap. A snap only counts if the hand tracker sees a held pinch and its release **and** the mic hears a sharp click at the same moment. A click alone or a hand pose alone never triggers.
- **V-sign (optional).** Turn on "V-sign trigger" in the popup and hold a peace sign for 0.7 s.
- **Snap now** button, or **Alt+Shift+S** (change at `chrome://extensions/shortcuts`).
- **Empty-room photo (recommended).** Click **Capture empty room** in the popup, step fully out of frame during the 5 s countdown, and that photo is what the call sees when you turn to dust. Brightness is matched to the live camera. Retake it if you move the camera. **Clear** deletes it.
- **Settings:** snap sensitivity, dust duration, dust direction, AI room fill. Higher sensitivity catches more snaps and more false ones.

Without a room photo, the extension learns the room from the parts the camera can see around you and fills the patch behind your body (with the AI model if installed, otherwise a smooth fill).

## Troubleshooting

The badge in the bottom-left of the call page names the stage that failed, and the popup status line shows hands in view, the live pinch value, clicks heard and when each gesture was last seen.

| Symptom | Fix |
|---|---|
| "Model files missing" | Run `node setup.mjs` in the extension folder, reload the extension |
| "No camera is hooked yet" | Toggle your camera off/on or rejoin, after enabling the extension |
| Snap now works, snap doesn't | Watch "hands in view" and "clicks heard" in the popup; add light, hold your hand 40-80 cm from the camera, raise sensitivity |
| Triggers by itself | Lower sensitivity; keep the V-sign option off |
| Choppy video | In `inject.js` set `MAX_W = 640` |
| Faint outline or patch where you were | Capture an empty-room photo |

## How it works

| File | Job |
|---|---|
| `inject.js` | Runs in the page. Replaces your camera and mic with processed versions, listens for the snap click |
| `engine.js`, `engine.html` | Extension iframe: hand tracking, gesture logic, person cut-out, room plate, dust effect |
| `lama-worker.js` | Optional AI room fill (ONNX Runtime, WebAssembly) |
| `content.js`, `background.js`, `popup.*` | Settings, shortcut, popup |
| `setup.mjs` | One-time model download |

## Development

    npm run check      # syntax + manifest sanity checks (no dependencies)
    npm run package    # builds dist/there-he-goes-<version>.zip (python3)

Edit files, then click reload on the extension card and refresh the call tab. CI (`.github/workflows/ci.yml`) runs the checks on every push.

## Publishing to GitHub

    git init
    git add .
    git commit -m "There he goes 1.1.0"
    git branch -M main
    git remote add origin https://github.com/<you>/there-he-goes.git
    git push -u origin main

The model files are git-ignored on purpose (they are large and have their own licenses). See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

## License

MIT, see [LICENSE](LICENSE).
