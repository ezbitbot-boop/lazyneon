import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { classifyTask } from '../scripts/classify-task.mjs';
const root = new URL('../', import.meta.url);
const read = p => fs.readFileSync(new URL(p, root), 'utf8');
function guard(message, extra = {}, env = {}) {
 const r = spawnSync(process.execPath, [fileURLToPath(new URL('scripts/reply_format_guard.mjs', root))], {
  input: JSON.stringify({ last_assistant_message: message, ...extra }), encoding: 'utf8',
  env: { ...process.env, LAZYNEON_REPLY_GUARD: '', ...env },
 });
 assert.equal(r.status, 0, r.stderr);
 const out = JSON.parse(r.stdout);
 assert.equal(out.decision, undefined, 'warn only; must never request continuation');
 return out.injectSteps?.[0]?.ephemeralMessage ?? '';
}
test('Korean rules: on-demand files fit budgets and are reachable from skills', () => {
 const files = ['korean-verb-usage.md', 'korean-punctuation.md', 'korean-natural-prose.md'];
 let bytes = Buffer.byteLength(read('rules/AGENTS.md'));
 for (const file of files) {
  const text = read(`rules/korean/${file}`);
  assert.ok(Buffer.byteLength(text) <= 8000);
  bytes += Buffer.byteLength(text);
  for (const skill of ['ulw', 'programming', 'remove-ai-slops']) assert.ok(read(`skills/${skill}/SKILL.md`).includes(file));
 }
 assert.ok(bytes <= 24000);
 assert.match(read('rules/AGENTS.md'), /rules\/korean\//);
 assert.doesNotMatch(read('scripts/session_start.mjs'), /korean-(?:verb|punctuation|natural)/);
 const hooks = JSON.parse(read('hooks.json'));
 assert.ok(hooks.hooks.Stop.some(h => h.command.includes('reply_format_guard.mjs')));
});
test('reply guard: positives and three-issue cap', () => {
 for (const word of ['혁신적인', '다면적인', '심리스한', '중추적인']) assert.match(guard(`${word} 결과입니다.`), /상투어/);
 for (const ending of ['고', '며', '지만']) assert.match(guard(`파일을 읽${ending}, 결과를 냅니다.`), /연결어미/);
 assert.match(guard('결과입니다. 🎉'), /이모지/);
 assert.match(guard('좋은 질문입니다. 결과는 같습니다.'), /도입/);
 assert.match(guard('결과는 같습니다. 도움이 되셨길 바랍니다.'), /마무리/);
 const note = guard('좋은 질문입니다. 혁신적인 결과이고, 좋습니다. 🎉 도움이 되셨길 바랍니다.');
 assert.equal(note.split('; ').length, 3);
});
test('reply guard: negatives, non-Korean, code blocks and off switch', () => {
 for (const text of ['파일을 읽고 결과를 냅니다.', '사과, 배를 샀습니다.', 'Hello 🎉',
  '결과입니다.\n```js\n혁신적인 읽고, 🎉\n```', '결과입니다.\n~~~\n좋은 질문입니다. 🎉\n~~~',
  '결과입니다.\n    혁신적인 읽고, 🎉']) assert.equal(guard(text), '');
 assert.equal(guard('혁신적인 결과 🎉', {}, { LAZYNEON_REPLY_GUARD: 'off' }), '');
});
test('reply guard: produced files require short actionable closing line', () => {
 assert.match(guard('파일을 저장했습니다.', { produced_files: ['a.md'] }), /마지막 안내/);
 assert.equal(guard('파일을 저장했습니다.\na.md를 열어 내용을 확인하세요.', { produced_files: ['a.md'] }), '');
 assert.equal(guard('설명을 마쳤습니다.'), '');
});
function classify(prompt, value) {
 const old = process.env.LAZYNEON_REASONING_LANG;
 if (value === undefined) delete process.env.LAZYNEON_REASONING_LANG;
 else process.env.LAZYNEON_REASONING_LANG = value;
 try { return classifyTask(prompt); }
 finally { if (old === undefined) delete process.env.LAZYNEON_REASONING_LANG; else process.env.LAZYNEON_REASONING_LANG = old; }
}
test('reasoning language: default off and English writing/coding opt-in', () => {
 for (const prompt of ['안녕하세요', 'write a tutorial', 'implement a parser', 'fix and test a parser']) {
  const off = classify(prompt);
  assert.equal(off.reasoning_language, 'ko');
  assert.ok(!off.rules.some(r => r.includes('Reason and draft in English')));
  const on = classify(prompt, 'en');
  assert.equal(on.reasoning_language, 'en');
  assert.ok(on.rules.some(r => r.includes('Reason and draft in English')));
 }
 assert.equal(classify('write a tutorial', 'fr').reasoning_language, 'ko');
});
test('reasoning language: protected and mixed evidence tasks force Korean', () => {
 for (const prompt of ['write legal advice', '계약서 작성', '법률 설명', 'forensic analysis', 'write PII parser',
  'security audit', 'final review', 'write evidence report', '증거 설명', 'write OCR tool',
  'implement count hashes', 'write verify evidence report', '판결문 작성', 'write sensitive data report']) {
  const r = classify(prompt, 'en');
  assert.equal(r.reasoning_language, 'ko', prompt);
  assert.ok(!r.rules.some(rule => rule.includes('Reason and draft in English')), prompt);
 }
});
test('reply guard: native transcript limits checks to current turn', () => {
 const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lazyneon-reply-'));
 const file = path.join(dir, 'transcript.jsonl');
 const save = rows => fs.writeFileSync(file, rows.map(r => JSON.stringify(r)).join('\n'));
 try {
  save([{ type: 'USER_INPUT', content: '파일 작성' },
   { type: 'PLANNER_RESPONSE', tool_calls: [{ name: 'write_to_file', args: { TargetFile: 'a.md' } }] },
   { type: 'PLANNER_RESPONSE', content: '파일을 저장했습니다.' }]);
  assert.match(guard(undefined, { transcriptPath: file }), /마지막 안내/);
  save([{ type: 'USER_INPUT', content: '파일 작성' },
   { type: 'PLANNER_RESPONSE', tool_calls: [{ name: 'write_to_file' }] },
   { type: 'USER_INPUT', content: '설명만' },
   { type: 'PLANNER_RESPONSE', content: '기본값은 셋입니다.' }]);
  assert.equal(guard(undefined, { transcriptPath: file }), '');
 } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
test('reasoning language: unknown evidence kinds fail closed', async () => {
 const { reasoningLanguage } = await import('../scripts/reasoning-language.mjs');
 for (const kind of ['legal', 'forensic', 'sensitive', 'PII', 'security_audit', 'final_review', 'evidence_collection']) {
  assert.equal(reasoningLanguage('write a function', kind, [kind], { LAZYNEON_REASONING_LANG: 'en' }), 'ko');
  assert.equal(reasoningLanguage('write a function', 'implementation', [kind], { LAZYNEON_REASONING_LANG: 'en' }), 'ko');
 }
});
test('reply guard: doctor accepts the registered Stop hook', () => {
 const r = spawnSync(process.execPath, ['scripts/doctor.mjs', '--json'], {
  encoding: 'utf8', env: { ...process.env, LAZYNEON_OFFLINE: '1' },
 });
 const checks = JSON.parse(r.stdout).checks;
 assert.equal(checks.find(c => c.id === 'hooks.mapping.Stop')?.status, 'ok');
 assert.equal(checks.find(c => c.id === 'rules.budget')?.status, 'ok');
});
