import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { SETTINGS, readConfig, settings } from '../scripts/settings.mjs';
import { autoUpdate, updatePlugin } from '../scripts/update.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tmp = t => {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lazyneon-config-'));
	t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
	return dir;
};
const configWith = (t, data) => {
	const file = path.join(tmp(t), 'local.json');
	fs.writeFileSync(file, typeof data === 'string' || Buffer.isBuffer(data) ? data : JSON.stringify(data));
	return file;
};
// Environment with every switch variable cleared, so only the given config decides.
const cleanEnv = extra => {
	const env = { ...process.env };
	for (const key of ['LAZYNEON_DISABLE_WRITE_CHUNK_GUARD', 'LAZYNEON_SELF_CHECK', 'LAZYNEON_OFFLINE', 'LAZYNEON_NO_UPDATE_CHECK', 'LAZYNEON_NO_AUTO_UPDATE', 'ANTIGRAVITY_TOOL_INPUT', 'TOOL_INPUT', 'LAZYNEON_MAX_WRITE_BYTES', 'LAZYNEON_MAX_WRITE_LINES']) delete env[key];
	return { ...env, ...extra };
};
const run = (script, payload, env) => spawnSync(process.execPath, [path.join(root, 'scripts', script)], { cwd: root, encoding: 'utf8', input: JSON.stringify(payload), env });
const OFF = { writeChunkGuard: false, selfCheck: false, offline: true, updateCheck: false };

test('config defaults apply when there is no file and no environment', t => {
	const s = settings({ LAZYNEON_CONFIG: path.join(tmp(t), 'missing.json') });
	for (const [key, spec] of Object.entries(SETTINGS)) {
		assert.equal(s[key], spec.default, key);
		assert.equal(s.source[key], 'default', key);
	}
	assert.equal(s.exists, false);
	assert.deepEqual(s.problems, []);
});

test('config file overrides defaults and the environment overrides the file', t => {
	const LAZYNEON_CONFIG = configWith(t, OFF);
	const fromFile = settings({ LAZYNEON_CONFIG });
	for (const key of Object.keys(OFF)) {
		assert.equal(fromFile[key], OFF[key], key);
		assert.equal(fromFile.source[key], 'file', key);
	}
	const fromEnv = settings({ LAZYNEON_CONFIG, LAZYNEON_DISABLE_WRITE_CHUNK_GUARD: '0', LAZYNEON_SELF_CHECK: 'on', LAZYNEON_OFFLINE: '0', LAZYNEON_NO_UPDATE_CHECK: '0' });
	assert.deepEqual({ ...Object.fromEntries(Object.keys(OFF).map(k => [k, fromEnv[k]])) }, { writeChunkGuard: true, selfCheck: true, offline: false, updateCheck: true });
	assert.ok(Object.values(fromEnv.source).every(source => source === 'env'));
	const envOff = settings({ LAZYNEON_CONFIG: configWith(t, { writeChunkGuard: true, selfCheck: true, offline: false, updateCheck: true }), LAZYNEON_DISABLE_WRITE_CHUNK_GUARD: '1', LAZYNEON_SELF_CHECK: 'OFF', LAZYNEON_OFFLINE: '1', LAZYNEON_NO_AUTO_UPDATE: '1' });
	assert.deepEqual([envOff.writeChunkGuard, envOff.selfCheck, envOff.offline, envOff.updateCheck], [false, false, true, false]);
});

test('config reader tolerates Notepad encodings and on/off words', t => {
	const json = JSON.stringify({ selfCheck: 'off', offline: 'on' });
	for (const data of [`\uFEFF${json}`, Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(json, 'utf16le')])]) {
		const config = readConfig({ LAZYNEON_CONFIG: configWith(t, data) });
		assert.deepEqual(config.problems, []);
		assert.deepEqual(config.values, { selfCheck: false, offline: true });
	}
});

test('config reader reports defects instead of throwing and cannot switch other guards', t => {
	assert.match(readConfig({ LAZYNEON_CONFIG: configWith(t, '{ "offline": true, }') }).problems[0], /JSON/);
	assert.match(readConfig({ LAZYNEON_CONFIG: configWith(t, '[]') }).problems[0], /객체/);
	const config = readConfig({ LAZYNEON_CONFIG: configWith(t, { _note: 'comment', offline: 'yes', evidenceGuard: false, stopGuard: 'off', secretGuard: false }) });
	assert.deepEqual(config.values, {});
	assert.equal(config.problems.length, 4, config.problems.join('\n'));
	assert.ok(config.problems.some(p => p.includes('"offline"')));
	for (const key of ['evidenceGuard', 'stopGuard', 'secretGuard']) assert.ok(config.problems.some(p => p.includes(key)), key);
	assert.deepEqual(Object.keys(SETTINGS).sort(), ['offline', 'selfCheck', 'updateCheck', 'writeChunkGuard']);
});

test('config file disables the write chunk guard, and the environment can re-enable it', t => {
	const LAZYNEON_CONFIG = configWith(t, { writeChunkGuard: false });
	const big = { toolCall: { name: 'write_file', args: { Path: 'a.txt', Content: 'x'.repeat(30000) } } };
	const off = run('write_chunk_guard.mjs', big, cleanEnv({ LAZYNEON_CONFIG }));
	assert.equal(off.status, 0, off.stderr);
	assert.equal(off.stdout, '{}\n');
	const envOn = run('write_chunk_guard.mjs', big, cleanEnv({ LAZYNEON_CONFIG, LAZYNEON_DISABLE_WRITE_CHUNK_GUARD: '0' }));
	assert.equal(envOn.status, 1, envOn.stderr);
	assert.equal(JSON.parse(envOn.stdout).decision, 'deny');
});

test('config file turns the Stop self-check off', t => {
	const ws = tmp(t);
	const payload = { cwd: ws, conversationId: 'cfg', last_assistant_message: '모든 검증을 100% 완벽하게 완료했습니다.' };
	const on = run('stop_claim_guard.mjs', payload, cleanEnv({ LAZYNEON_CONFIG: configWith(t, {}), LAZYNEON_STOP_GUARD: 'observe' }));
	assert.equal(JSON.parse(on.stdout).decision, 'continue', on.stderr);
	const off = run('stop_claim_guard.mjs', { ...payload, conversationId: 'cfg-off' }, cleanEnv({ LAZYNEON_CONFIG: configWith(t, { selfCheck: false }), LAZYNEON_STOP_GUARD: 'observe' }));
	assert.equal(off.status, 0, off.stderr);
	assert.deepEqual(JSON.parse(off.stdout), {});
});

test('config file offline and updateCheck stop the update check and the manual update', t => {
	const dir = tmp(t);
	const git = (...args) => {
		const r = spawnSync('git', ['-C', dir, '-c', 'user.name=t', '-c', 'user.email=t@example.invalid', ...args], { encoding: 'utf8' });
		assert.equal(r.status, 0, r.stderr);
		return r.stdout.trim();
	};
	git('init', '-q', '-b', 'main');
	fs.writeFileSync(path.join(dir, 'a.txt'), 'a\n');
	git('add', 'a.txt');
	git('commit', '-q', '-m', 'init');
	git('remote', 'add', 'origin', path.join(dir, 'missing-remote'));
	const state = path.join(git('rev-parse', '--absolute-git-dir'), 'lazyneon-last-update-check');
	for (const data of [{ updateCheck: false }, { offline: true }]) {
		autoUpdate(dir, { LAZYNEON_CONFIG: configWith(t, data) }, { write() {} });
		assert.equal(fs.existsSync(state), false, JSON.stringify(data));
	}
	assert.throws(() => updatePlugin(dir, { LAZYNEON_CONFIG: configWith(t, { offline: true }) }, { write() {} }), /offline mode.*update disabled/);
	// The environment outranks the file: an explicit 0 runs the (failing, throttled) check.
	autoUpdate(dir, { LAZYNEON_CONFIG: configWith(t, { updateCheck: false }), LAZYNEON_NO_UPDATE_CHECK: '0' }, { write() {} });
	assert.equal(fs.existsSync(state), true);
});

test('config file offline is honoured by the research access route', async t => {
	const { accessUrl } = await import('../skills/ulw-research/scripts/access-method.mjs');
	const saved = { config: process.env.LAZYNEON_CONFIG, offline: process.env.LAZYNEON_OFFLINE };
	t.after(() => {
		for (const [key, value] of [['LAZYNEON_CONFIG', saved.config], ['LAZYNEON_OFFLINE', saved.offline]]) {
			if (value === undefined) delete process.env[key];
			else process.env[key] = value;
		}
	});
	delete process.env.LAZYNEON_OFFLINE;
	process.env.LAZYNEON_CONFIG = configWith(t, { offline: true });
	assert.equal((await accessUrl('https://8.8.8.8/', { root: tmp(t), consent: () => true })).status, 'offline');
});

test('doctor and the SessionStart block show file switches and config problems', async t => {
	const bad = configWith(t, { writeChunkGuard: false, stopGuard: false });
	const doctor = spawnSync(process.execPath, [path.join(root, 'scripts', 'doctor.mjs'), '--json'], { cwd: root, encoding: 'utf8', env: cleanEnv({ LAZYNEON_CONFIG: bad, LAZYNEON_OFFLINE: '1', LAZYNEON_LS_RPC_MOCK_JSON: '' }) });
	const check = JSON.parse(doctor.stdout).checks.find(c => c.id === 'config');
	assert.equal(check.status, 'warn', doctor.stdout);
	assert.match(check.detail, /stopGuard/);
	assert.match(check.detail, /writeChunkGuard=false\(설정 파일\)/);
	const { runtimeContext } = await import('../scripts/session_start.mjs');
	const saved = process.env.LAZYNEON_CONFIG;
	t.after(() => { if (saved === undefined) delete process.env.LAZYNEON_CONFIG; else process.env.LAZYNEON_CONFIG = saved; });
	process.env.LAZYNEON_CONFIG = bad;
	assert.match(runtimeContext({ cwd: tmp(t) }), /설정 파일 .*writeChunkGuard=false \(문제: .*stopGuard/);
	process.env.LAZYNEON_CONFIG = configWith(t, { writeChunkGuard: true });
	assert.doesNotMatch(runtimeContext({ cwd: tmp(t) }), /설정 파일/);
});
