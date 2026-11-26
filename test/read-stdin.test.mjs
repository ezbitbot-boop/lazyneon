import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const moduleUrl = pathToFileURL(path.join(root, 'scripts', 'read-stdin.mjs')).href;

// Runs readStdin(limitMs) in a child; `writes` are [delayMs, Buffer|string] steps; `end` closes stdin afterwards.
function harness(limitMs, writes, { end = false } = {}) {
	// Hook scripts exit explicitly once they answer; a paused stdin pipe would otherwise keep the child alive.
	const code = `import { readStdin } from ${JSON.stringify(moduleUrl)}; process.stdout.write(JSON.stringify(await readStdin(${limitMs})), () => process.exit(0));`;
	const child = spawn(process.execPath, ['--input-type=module', '-e', code], { stdio: ['pipe', 'pipe', 'pipe'] });
	let stdout = '', stderr = '';
	child.stdout.setEncoding('utf8').on('data', c => { stdout += c; });
	child.stderr.setEncoding('utf8').on('data', c => { stderr += c; });
	(async () => {
		for (const [delay, chunk] of writes) {
			await new Promise(r => setTimeout(r, delay));
			child.stdin.write(chunk);
		}
		if (end) child.stdin.end();
	})();
	return new Promise(resolve => child.on('close', status => {
		child.stdin.destroy();
		resolve({ status, value: stdout ? JSON.parse(stdout) : undefined, stderr });
	}));
}

test('readStdin resolves on a complete JSON payload while the host keeps the pipe open', { timeout: 20000 }, async () => {
	const r = await harness(60000, [[0, '  {"toolCall":{"name":"write_file"}}\n']]);
	assert.equal(r.status, 0, r.stderr);
	assert.equal(r.value, '{"toolCall":{"name":"write_file"}}');
});

test('readStdin keeps a multi-byte character split across chunks intact', { timeout: 20000 }, async () => {
	const bytes = Buffer.from('{"a":"홍길동"}', 'utf8');
	const cut = bytes.indexOf(Buffer.from('길', 'utf8')) + 1; // inside the 3-byte sequence
	const r = await harness(60000, [[0, bytes.subarray(0, cut)], [50, bytes.subarray(cut)]]);
	assert.equal(r.value, '{"a":"홍길동"}');
});

test('readStdin returns non-JSON input untrimmed at end of input', async () => {
	assert.equal((await harness(60000, [[0, ' plain text \n']], { end: true })).value, ' plain text \n');
});

test('readStdin returns what arrived when the deadline passes', async () => {
	assert.equal((await harness(200, [])).value, '');
	assert.equal((await harness(200, [[0, '{"a":']])).value, '{"a":');
});

test('readStdin has one implementation, used by every core hook script', () => {
	const scripts = fs.readdirSync(path.join(root, 'scripts')).filter(f => f.endsWith('.mjs'));
	const defining = scripts.filter(f => /function readStdin\b/.test(fs.readFileSync(path.join(root, 'scripts', f), 'utf8')));
	assert.deepEqual(defining, ['read-stdin.mjs']);
	const hooks = JSON.stringify(JSON.parse(fs.readFileSync(path.join(root, 'hooks.json'), 'utf8')));
	const hookScripts = [...new Set([...hooks.matchAll(/\.\/scripts\/([\w.-]+\.mjs)/g)].map(m => m[1]))];
	assert.ok(hookScripts.length >= 8, hookScripts.join(', '));
	for (const file of hookScripts) assert.match(fs.readFileSync(path.join(root, 'scripts', file), 'utf8'), /from ['"]\.\/read-stdin\.mjs['"]/, file);
});

// Scripts that answer and exit on their own; the host may keep stdin open after writing the payload.
const SELF_EXITING_HOOKS = ['json_schema_guard.mjs', 'lookup_guard.mjs', 'markdown_structure_guard.mjs', 'reply_format_guard.mjs', 'stop_claim_guard.mjs', 'usage_guard.mjs', 'write_chunk_guard.mjs'];

test('self-exiting hook scripts give the same answer whether stdin ends or stays open after the payload', { timeout: 60000 }, async () => {
	const payload = JSON.stringify({ hook_event_name: 'Test', conversationId: 'stdin-eq', toolCall: { name: 'read_file', args: { Path: 'README.md' } } });
	const env = { ...process.env, LAZYNEON_OFFLINE: '1', LAZYNEON_NO_AUTO_UPDATE: '1', LAZYNEON_SELF_CHECK: 'off', LAZYNEON_FEEDBACK_DIR: fs.mkdtempSync(path.join(os.tmpdir(), 'lazyneon-stdin-')) };
	try {
		for (const file of SELF_EXITING_HOOKS) {
			const script = path.join(root, 'scripts', file);
			const closed = spawnSync(process.execPath, [script], { cwd: root, encoding: 'utf8', input: payload, env });
			const open = await new Promise(resolve => {
				const child = spawn(process.execPath, [script], { cwd: root, env });
				let stdout = '';
				child.stdout.setEncoding('utf8').on('data', c => { stdout += c; });
				child.stdin.write(payload);
				child.on('close', status => { child.stdin.destroy(); resolve({ status, stdout }); });
			});
			assert.equal(open.status, closed.status, file);
			assert.equal(open.stdout, closed.stdout, file);
		}
	} finally {
		fs.rmSync(env.LAZYNEON_FEEDBACK_DIR, { recursive: true, force: true });
	}
});
