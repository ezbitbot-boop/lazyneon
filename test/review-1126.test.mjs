import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const env = { ...process.env, LAZYNEON_OFFLINE: '1', LAZYNEON_NO_AUTO_UPDATE: '1' };
const tmp = (t, prefix = 'lazyneon-review-') => {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
	t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
	return dir;
};
const runScript = (script, payload, extraEnv = {}, cwd = root) => spawnSync(process.execPath, [path.join(root, 'scripts', script)], {
	cwd, encoding: 'utf8', input: typeof payload === 'string' ? payload : JSON.stringify(payload), env: { ...env, ...extraEnv },
});
const sha256 = text => createHash('sha256').update(text, 'utf8').digest('hex');

// Synthetic case text only.
const CASE_ANSWER = '모든 검증을 100% 완벽하게 완료했습니다. 피의자 홍길동의 메시지는 37건이다.';

test('stop guard logs keep only a hash and length of the answer, never its text', t => {
	const ws = tmp(t);
	for (const selfCheck of ['off', 'on']) {
		const r = runScript('stop_claim_guard.mjs', { cwd: ws, conversationId: `c-${selfCheck}`, last_assistant_message: CASE_ANSWER }, { LAZYNEON_STOP_GUARD: 'observe', LAZYNEON_SELF_CHECK: selfCheck });
		assert.equal(r.status, 0, r.stderr);
	}
	const log = fs.readFileSync(path.join(ws, '.lazyneon', 'stop-guard.jsonl'), 'utf8');
	assert.doesNotMatch(log, /홍길동|37건|excerpt/);
	const entries = log.trim().split('\n').map(line => JSON.parse(line));
	const observed = entries.filter(e => e.mode === 'observe');
	assert.ok(observed.length >= 2, log);
	for (const e of observed) assert.deepEqual(e.answer, { sha256: sha256(CASE_ANSWER), length: CASE_ANSWER.length });
	const selfCheck = entries.find(e => e.mode === 'self_check');
	assert.ok(selfCheck?.sentences.length, log);
	for (const s of selfCheck.sentences) {
		assert.deepEqual(Object.keys(s).sort(), ['kind', 'length', 'sha256']);
		assert.match(s.sha256, /^[0-9a-f]{64}$/);
	}
});

test('stop guard writes nothing to home or the hook cwd when the workspace is unknown', t => {
	const home = tmp(t), cwd = tmp(t);
	for (const selfCheck of ['off', 'on']) {
		const r = runScript('stop_claim_guard.mjs', { conversationId: 'no-ws', last_assistant_message: CASE_ANSWER }, { HOME: home, USERPROFILE: home, LAZYNEON_STOP_GUARD: 'observe', LAZYNEON_SELF_CHECK: selfCheck }, cwd);
		assert.equal(r.status, 0, r.stderr);
	}
	assert.deepEqual(fs.readdirSync(home), []);
	assert.deepEqual(fs.readdirSync(cwd), []);
});

test('lookup guard warns but writes no ledger to home when the workspace is unknown', t => {
	const home = tmp(t), cwd = tmp(t), transcript = path.join(tmp(t), 'transcript.jsonl');
	fs.writeFileSync(transcript, [{ type: 'USER_INPUT', content: 'search' }, { type: 'PLANNER_RESPONSE', tool_calls: [{ name: 'grep_search', args: { query: '홍길동' } }] }, { type: 'GENERIC', step_index: 2, content: 'No results found' }].map(JSON.stringify).join('\n'));
	const r = runScript('lookup_guard.mjs', { conversationId: 'no-ws', transcriptPath: transcript }, { HOME: home, USERPROFILE: home, LAZYNEON_LOOKUP_WARN: '1' }, cwd);
	assert.equal(r.status, 0, r.stderr);
	assert.match(r.stderr, /LOOKUP GUARD\] WARN/);
	assert.deepEqual(fs.readdirSync(home), []);
	assert.deepEqual(fs.readdirSync(cwd), []);
});
