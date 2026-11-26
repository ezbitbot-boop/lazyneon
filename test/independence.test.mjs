import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { getAction, sessionNotice } from '../scripts/classify-task.mjs';
import { auditReceipts } from '../scripts/upstream_radar.mjs';
import { RULES_FILE_WARN_BYTES, RULES_TOTAL_WARN_BYTES } from '../scripts/rules-budget.mjs';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const routing = JSON.parse(fs.readFileSync(path.join(root, 'skills/ulw/references/model-routing.json')));
function run(script, args = [], env = {}) {
 const r = spawnSync(process.execPath, [path.join(root, 'scripts', script), ...args], { encoding: 'utf8', env: { ...process.env, LAZYNEON_OFFLINE: '1', LAZYNEON_NO_AUTO_UPDATE: '1', ...env } });
 assert.ok(r.stdout, r.stderr);
 return JSON.parse(r.stdout);
}
function classify(prompt) { return run('classify-task.mjs', [prompt]); }
for (const role of ['plan', 'final_review', 'security_audit', 'forensic_verdict', 'pii_inject_docfmt', 'verdict_review']) {
 test(`gate ${role} enforces model family and tier before non-Neon return`, () => {
  const required = routing.roles[role].model;
  for (const session of ['gemini-4-hydrogen-low', 'gemini-4-hydrogen-xhigh', 'gemini-4-carbon-xhigh', 'gemini-4-neon-low', 'gemini-4-neon']) {
   assert.match(getAction(required, routing.roles, role, 'single', routing.subagent_tiers, session), session.startsWith('gemini-4-neon') ? /^proceed/ : new RegExp(`^delegate: invoke_subagent ${required}`));
   assert.match(getAction(required, routing.roles, role, 'single', {}, session), session.startsWith('gemini-4-neon') ? /^proceed/ : new RegExp(`^refuse: needs ${required}`));
   assert.ok(sessionNotice(required, routing.roles, session));
  }
  assert.match(getAction(required, routing.roles, role, 'single', routing.subagent_tiers, required), /^proceed in session/);
 });
}
test('resolved tiers and unknown levels produce honest notice', () => {
 for (const level of ['low', 'medium', 'high']) assert.ok(sessionNotice('gemini-4-neon-xhigh', routing.roles, `gemini-4-neon-${level}`));
 assert.match(sessionNotice('gemini-4-neon-high', routing.roles, 'gemini-4-neon-xhigh'), /비용/);
 assert.match(sessionNotice('gemini-4-neon-high', routing.roles, 'gemini-4-neon'), /미확인/);
});
test('compound implementation retains every Neon gate separately', () => {
 const r = classify('implement build fix refactor 5 files; plan; final review; security audit; forensic; pii; verdict');
 for (const role of ['plan', 'final_review', 'security_audit', 'forensic_verdict', 'pii_inject_docfmt', 'verdict_review']) {
  assert.ok(r.steps.some(s => s.role === role && s.model.startsWith('gemini-4-neon-')), role);
 }
 assert.ok(r.steps.some(s => s.role === 'implementation' && s.model === routing.protected_materials.parallel_workers));
 assert.ok(r.steps.every(s => !s.model.includes('hydrogen')), 'protected compound execution excludes the entire Hydrogen family');
});
test('final_review reachable independently from ordinary judgment', () => {
 for (const p of ['최종 리뷰', '최종 검토', 'final review', '승인']) assert.equal(classify(p).kind, 'final_review');
 assert.equal(classify('review').kind, 'judgment');
});
test('long context never fans out even with implementation and gates', () => {
 for (const p of ['250k 5 files implement', '300k parallel implement final review', '250000 tokens 10 files', 'entire codebase parallel']) {
  const r = classify(p);
  assert.equal(r.mode, 'single');
  assert.equal(r.worker_model, null);
  assert.ok(r.steps.every(s => !s.model.includes('hydrogen')));
  assert.equal(r.min_context_tokens, null);
 }
 const r = classify('250k');
 assert.equal(r.fallback, 'gemini-4-carbon-high');
 assert.equal(r.timeout_sec, null);
});
test('general reading remains single regardless of file count', () => {
 for (const verb of ['요약', '설명', '읽기', 'summarize', 'explain', 'read']) {
  assert.equal(classify(`${verb} a.ts b.ts c.ts 20 files parallel`).mode, 'single');
 }
});
test('external receipt records skip without counting as verified', () => {
 const r = auditReceipts();
 assert.equal(r.ok, true);
 assert.equal(r.status, 'skip');
 assert.ok(r.skipped_targets.length > 0);
 for (const t of r.skipped_targets) {
  assert.equal(t.status, 'skip');
  assert.ok(!r.verified_target_list.includes(t.path));
 }
 const checks = run('doctor.mjs', ['--json']).checks;
 assert.ok(checks.some(c => c.id === 'skills.source_receipts.external' && c.status === 'skip'));
 assert.equal(checks.find(c => c.id === 'antigravity.live_rpc').status, 'skip');
});
test('disabled or missing core fails RPC; companion does not impersonate core', () => {
 for (const states of [[], [{ name: 'lazyneon', status: 'STATUS_DISABLED' }], [{ name: 'lazyneon-workspace', status: 'STATUS_ENABLED' }]]) {
  const r = run('doctor.mjs', ['--json'], { LAZYNEON_LS_RPC_MOCK_JSON: JSON.stringify({ states }) });
  assert.equal(r.checks.find(c => c.id === 'antigravity.live_rpc').status, 'fail');
 }
});
test('invalid config warns and routing coverage rejects substring matches', () => {
 const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'neon-regression-'));
 try {
  fs.mkdirSync(path.join(tmp, '.gemini'));
  fs.writeFileSync(path.join(tmp, '.gemini/settings.json'), '{broken');
  fs.mkdirSync(path.join(tmp, 'skills/foo'), { recursive: true });
  fs.mkdirSync(path.join(tmp, 'rules'));
  fs.writeFileSync(path.join(tmp, 'skills/foo/SKILL.md'), '---\nname: foo\ndescription: foo\n---\n');
  for (const mention of ['foobar', 'prefix-foo', 'foo-suffix']) {
   fs.writeFileSync(path.join(tmp, 'rules/AGENTS.md'), mention);
   const r = run('doctor.mjs', ['--json'], { HOME: tmp, USERPROFILE: tmp, LAZYNEON_TEST_SKILL_ROOT: tmp });
   assert.equal(r.checks.find(c => c.id === 'skills.routing_coverage').status, 'fail');
   const config = r.checks.find(c => c.id === 'antigravity.model_provider');
   assert.equal(config.status, 'warn');
   assert.match(config.detail, /미확인/);
  }
  fs.writeFileSync(path.join(tmp, 'rules/AGENTS.md'), '`skills/foo/SKILL.md`');
  assert.equal(run('doctor.mjs', ['--json'], { LAZYNEON_TEST_SKILL_ROOT: tmp }).checks.find(c => c.id === 'skills.routing_coverage').status, 'ok');
 } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});
test('one rule budget, one STT procedure, declared unfinished modes and release versions', () => {
 assert.equal(RULES_FILE_WARN_BYTES, 16000);
 assert.equal(RULES_TOTAL_WARN_BYTES, 24000);
 const rules = fs.readFileSync(path.join(root, 'rules/AGENTS.md'), 'utf8');
 assert.match(rules, /파일당 16,000B, 합계 24,000B/);
 assert.match(rules, /≥4,096 tokens/);
 assert.match(rules, /95%.*\$0.15.*\$3/);
 assert.doesNotMatch(rules, /recognize_google|로컬 Whisper 금지/);
 assert.match(routing.roles.tool_first.rule, /media-transcription.md/);
 assert.equal(routing.roles.tool_first.stt_model, routing.roles.tool_first.model);
 for (const mode of ['swarm', 'boost', 'teamwork']) assert.equal(routing.modes[mode].status, '미구현');
 assert.match(routing.quota_guard.note, /observed limits block until recovery/);
 for (const file of ['plugin.json', 'package.json']) assert.equal(JSON.parse(fs.readFileSync(path.join(root, file))).version, '0.4.4');
 for (const file of ['skills/ulw/SKILL.md', 'skills/ulw/references/dual-verify.md']) assert.doesNotMatch(fs.readFileSync(path.join(root, file), 'utf8'), /claude-opus|Claude Sonnet/);
});

test('long-context session cannot proceed on Hydrogen and RPC unknown is not ok', () => {
 const required = routing.roles.long_context.model;
 assert.match(getAction(required, routing.roles, 'long_context', 'single', routing.subagent_tiers, 'gemini-4-hydrogen-high'), /^delegate: invoke_subagent gemini-4-neon-high/);
 assert.match(getAction(required, routing.roles, 'long_context', 'single', {}, 'gemini-4-hydrogen-high'), /^refuse: needs gemini-4-neon-high/);
 const r = run('doctor.mjs', ['--json'], { LAZYNEON_LS_RPC_MOCK_JSON: JSON.stringify({ states: [{ name: 'lazyneon', status: 'UNKNOWN' }] }) });
 assert.equal(r.checks.find(c => c.id === 'antigravity.live_rpc').status, 'warn');
});

test('research procedures resolve collection and judgment roles without retired flash policy', () => {
 for (const file of ['skills/ulw-research/SKILL.md', 'skills/ulw-research/references/wave-composition.md']) {
  const text = fs.readFileSync(path.join(root, file), 'utf8');
  assert.match(text, /Hydrogen `flash`/);
  assert.match(text, /Neon `pro`/);
  assert.doesNotMatch(text, /flash[`"]? retired|never use `"flash"`|all lanes.*`inherit`/);
 }
});
