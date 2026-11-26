/**
 * settings.mjs — file-based switches for people who cannot set environment variables.
 *
 * File: <plugin>/config/local.json (git-ignored; copy config/local.example.json). LAZYNEON_CONFIG may point elsewhere.
 * Precedence for every key: environment variable > config file > default.
 * Only these escape hatches are configurable. Evidence, secret and provenance guards are not, and keys
 * for them are ignored and reported as problems.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

const flag = value => {
	const s = String(value ?? '').trim().toLowerCase();
	return s === '' ? undefined : s;
};

// key → default and how the existing environment variables decide it (undefined = env silent).
export const SETTINGS = {
	writeChunkGuard: { default: true, env: 'LAZYNEON_DISABLE_WRITE_CHUNK_GUARD', fromEnv: env => { const v = flag(env.LAZYNEON_DISABLE_WRITE_CHUNK_GUARD); return v === undefined ? undefined : v !== '1'; } },
	selfCheck: { default: true, env: 'LAZYNEON_SELF_CHECK', fromEnv: env => { const v = flag(env.LAZYNEON_SELF_CHECK); return v === undefined ? undefined : v !== 'off'; } },
	offline: { default: false, env: 'LAZYNEON_OFFLINE', fromEnv: env => { const v = flag(env.LAZYNEON_OFFLINE); return v === undefined ? undefined : v === '1'; } },
	updateCheck: {
		default: true,
		env: 'LAZYNEON_NO_UPDATE_CHECK / LAZYNEON_NO_AUTO_UPDATE',
		fromEnv: env => {
			const values = [flag(env.LAZYNEON_NO_UPDATE_CHECK), flag(env.LAZYNEON_NO_AUTO_UPDATE)];
			if (values.includes('1')) return false;
			return values.every(v => v === undefined) ? undefined : true;
		},
	},
};

const BOOLEAN_WORDS = { true: true, on: true, false: false, off: false };

export function configFile(env = process.env, dir = root) {
	return flag(env.LAZYNEON_CONFIG) ? String(env.LAZYNEON_CONFIG).trim() : join(dir, 'config', 'local.json');
}

/** {file, exists, values, problems}. A missing file is normal; every other defect is a problem, never an exception. */
export function readConfig(env = process.env, dir = root) {
	const file = configFile(env, dir);
	const result = { file, exists: false, values: {}, problems: [] };
	let buffer;
	try {
		buffer = readFileSync(file);
	} catch (error) {
		if (error.code !== 'ENOENT') result.problems.push(`읽기 실패: ${error.message}`);
		return result;
	}
	result.exists = true;
	// Windows Notepad may save UTF-16 or UTF-8 with a byte-order mark.
	const text = (buffer[0] === 0xff && buffer[1] === 0xfe ? buffer.toString('utf16le') : buffer.toString('utf8')).replace(/^\uFEFF/, '');
	let data;
	try {
		data = JSON.parse(text);
	} catch (error) {
		result.problems.push(`JSON 형식 오류: ${error.message}`);
		return result;
	}
	if (!data || typeof data !== 'object' || Array.isArray(data)) {
		result.problems.push('맨 바깥은 { } 객체여야 한다');
		return result;
	}
	for (const [key, value] of Object.entries(data)) {
		if (key.startsWith('_')) continue; // comment keys
		if (!Object.hasOwn(SETTINGS, key)) {
			result.problems.push(`알 수 없는 항목 "${key}" 무시 (설정 가능: ${Object.keys(SETTINGS).join(', ')})`);
			continue;
		}
		const word = typeof value === 'string' ? BOOLEAN_WORDS[value.trim().toLowerCase()] : value;
		if (typeof word !== 'boolean') {
			result.problems.push(`"${key}" 값은 true 또는 false 여야 한다 (지금: ${JSON.stringify(value)}) — 기본값 사용`);
			continue;
		}
		result.values[key] = word;
	}
	return result;
}

/** Effective switches with where each came from ('env' | 'file' | 'default'). */
export function settings(env = process.env, dir = root) {
	const config = readConfig(env, dir);
	const out = { file: config.file, exists: config.exists, problems: config.problems, source: {} };
	for (const [key, spec] of Object.entries(SETTINGS)) {
		const fromEnv = spec.fromEnv(env);
		const [value, source] = fromEnv !== undefined ? [fromEnv, 'env'] : key in config.values ? [config.values[key], 'file'] : [spec.default, 'default'];
		out[key] = value;
		out.source[key] = source;
	}
	return out;
}
