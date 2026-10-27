#!/usr/bin/env python3
"""Build dist/there-he-goes-<version>.zip containing only what Chrome needs (no models, no dev files)."""
import json, os, zipfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
INCLUDE = ["manifest.json", "background.js", "content.js", "inject.js", "engine.html", "engine.js",
           "lama-worker.js", "popup.html", "popup.js", "setup.mjs", "README.md", "LICENSE",
           "PRIVACY.md", "THIRD_PARTY_NOTICES.md", "lib/.gitkeep", "models/.gitkeep"]
INCLUDE += ["icons/" + f for f in sorted(os.listdir(os.path.join(ROOT, "icons"))) if f.endswith(".png")]

version = json.load(open(os.path.join(ROOT, "manifest.json")))["version"]
os.makedirs(os.path.join(ROOT, "dist"), exist_ok=True)
out = os.path.join(ROOT, "dist", f"there-he-goes-{version}.zip")
with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as z:
    for rel in INCLUDE:
        z.write(os.path.join(ROOT, rel), os.path.join("there-he-goes", rel))
print("wrote", out)
