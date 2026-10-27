// Dependency-free sanity checks: syntax of every script + manifest wiring. Run: npm run check
import { readFileSync, existsSync, mkdtempSync, copyFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const scripts = ['background.js', 'content.js', 'inject.js', 'engine.js', 'lama-worker.js', 'popup.js', 'setup.mjs'];
const tmp = mkdtempSync(join(tmpdir(), 'thg-'));
let bad = 0;
const fail = (m) => { bad++; console.error('FAIL', m); };

for (const f of scripts) {
  const copy = join(tmp, basename(f).replace(/\.js$/, '.mjs'));
  copyFileSync(join(root, f), copy);
  try { execFileSync(process.execPath, ['--check', copy], { stdio: 'pipe' }); console.log('ok  ', f); }
  catch (e) { fail(f + '\n' + String(e.stderr)); }
}

const m = JSON.parse(readFileSync(join(root, 'manifest.json'), 'utf8'));
const refs = [m.background?.service_worker, m.action?.default_popup, ...Object.values(m.icons || {}),
  ...(m.content_scripts || []).flatMap((c) => c.js), ...(m.web_accessible_resources || []).flatMap((r) => r.resources)];
for (const r of refs) if (r && !existsSync(join(root, r))) fail('manifest references missing file: ' + r);
if (m.manifest_version !== 3) fail('manifest_version must be 3');
if (!/wasm-unsafe-eval/.test(m.content_security_policy?.extension_pages || '')) fail("CSP must allow 'wasm-unsafe-eval'");
if (!(m.content_scripts || []).some((c) => c.world === 'MAIN' && c.run_at === 'document_start')) fail('inject.js must run in MAIN world at document_start');
console.log(bad ? `\n${bad} problem(s)` : '\nAll checks passed');
process.exit(bad ? 1 : 0);
