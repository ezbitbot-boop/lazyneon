import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
const read = name => fs.readFileSync(path.join(root, name), 'utf8');
function fixture(t) {
 const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'improve2-core-'));
 t.after(() => fs.rmSync(dir, {recursive:true, force:true}));
 return dir;
}
function doctor(cwd) {
 const r = spawnSync(process.execPath, [path.join(root, 'scripts/doctor.mjs'), '--json'], {
  cwd, encoding:'utf8', env:{...process.env, LAZYNEON_OFFLINE:'1'},
 });
 assert.equal(r.status, 0, r.stderr + r.stdout);
 return JSON.parse(r.stdout).checks;
}
test('improve2 budget counts actual SessionStart text, including long single-line pins', t => {
 const cwd = fixture(t);
 fs.mkdirSync(path.join(cwd, '.lazyneon'));
 fs.writeFileSync(path.join(cwd, '.lazyneon/pins.md'), '가'.repeat(9000));
 const check = doctor(cwd).find(c => c.id === 'rules.budget');
 assert.equal(check.status, 'warn', check.detail);
 assert.match(check.detail, /SessionStart \d+B/);
});
test('improve2 budget enforces workspace rule bytes in the combined total', t => {
 const cwd = fixture(t);
 for (const file of ['AGENTS.md', 'GEMINI.md']) fs.writeFileSync(path.join(cwd, file), 'x'.repeat(12000));
 const check = doctor(cwd).find(c => c.id === 'rules.budget');
 assert.equal(check.status, 'warn', check.detail);
 assert.match(check.detail, /워크스페이스 24000B/);
});
test('improve2 SessionStart forces notify-only and keeps stdout JSON separate from stderr', t => {
 const cwd = fixture(t);
 fs.cpSync(path.join(root, 'scripts'), path.join(cwd, 'scripts'), {recursive:true});
 fs.cpSync(path.join(root, 'skills/ulw/references'), path.join(cwd, 'skills/ulw/references'), {recursive:true});
 // Observe the update boundary without fetching refs or mutating a Git repository.
 fs.writeFileSync(path.join(cwd, 'scripts/update.mjs'), `export function autoUpdate(root, env = process.env) {
 process.stderr.write('update boundary\\n');
 if (env.LAZYNEON_AUTO_UPDATE === '1') throw Error('SessionStart allowed code mutation');
 return 'LazyNeon update available: fixture';
 }`);
 const r = spawnSync(process.execPath, [path.join(cwd, 'scripts/session_start.mjs')], {
  cwd, input:'{}', encoding:'utf8', env:{...process.env, LAZYNEON_AUTO_UPDATE:'1'},
 });
 assert.equal(r.status, 0, r.stderr);
 assert.equal(r.stdout.trim().split('\n').length, 1);
 const output = JSON.parse(r.stdout);
 assert.deepEqual(Object.keys(output), ['injectSteps']);
 assert.equal(output.injectSteps[0].systemMessage.systemMessage.split('LazyNeon update available: fixture').length, 2);
 assert.equal(r.stderr, 'update boundary\n');
});
test('improve2 release metadata and changelog are 0.4.4', () => {
 for (const file of ['package.json', 'plugin.json']) assert.equal(JSON.parse(read(file)).version, '0.4.4');
 for (const file of ['README.md', 'rules/AGENTS.md']) assert.match(read(file), /LazyNeon \(`v0\.4\.4`\)/);
 // An optional "# Unreleased" section may precede the latest release heading.
 assert.match(read('CHANGELOG.md'), /^(?:# Unreleased\n(?:(?!# )[^\n]*\n)*)?# 0\.4\.4/);
});
test('improve2 README attributes pins and scope loading to core SessionStart', () => {
 assert.doesNotMatch(read('README.md'), /동반 플러그인은 `pins.md`, `ulw-scope.md`를 읽기만/);
 assert.match(read('README.md'), /코어 SessionStart가 `pins.md`, `ulw-scope.md`를 읽어 런타임 문맥에 주입/);
});
