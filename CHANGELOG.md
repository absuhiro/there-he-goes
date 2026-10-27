# Changelog

## 1.1.3
- Fix: after capturing a room photo, the background was forgotten on the first snap (a late AI-fill result overwrote the photo). A photo now always wins over fills still in progress.

## 1.1.2
- Fix: busy/detailed backgrounds got a washed-out patch where you were. The large shadow margin is now used only on plain walls; detailed rooms keep a thin margin.
- New: auto-capture. The first time you step out of frame for ~2 s, the empty room is photographed automatically (toggle in the popup).

## 1.1.1
- Fix: a dark person-shaped "shadow" left in the empty room. The soft shadow you cast on the wall is no longer kept as background; the area around you (about 60 px) is re-created instead.
- Fix: faint smudges from a moving hand. Pixels must hold still before they are learned, and large sudden changes are ignored.
- Tip badge on the first snap if no empty-room photo has been captured.

## 1.1.0
- Fix: leftover "shadow" outline after you turn to dust (dissolve field now covers the whole frame; fringe pixels can no longer survive).
- Fix: the room learner no longer absorbs your cast shadow (asymmetric adaptation, wider exclusion halo, frozen while you are dust, brightness matching instead).
- Fix: filled areas get a feathered seam, so no visible patch outline.
- Fix: false auto-triggers. A snap now needs a held pinch + release + mic click together; the click must be broadband; there is a lockout covering the whole animation.
- New: empty-room photo capture (5 s countdown), stored locally, matched to live brightness.
- New: optional V-sign trigger.

## 1.0.0
- First version.
