#!/usr/bin/env node
/**
 * destructive_guard.mjs — PreToolUse guard against wiping drives, the home folder or anything outside the workspace.
 *
 * Denies recursive or forced deletes (rm -rf, Remove-Item -Recurse -Force and its aliases, del /s /q, rd /s /q,
 * find -delete / -exec rm, xargs rm, robocopy /MIR, rsync --delete) whose target is a drive root, the home folder
 * or one of its ancestors, the workspace itself, or any path outside the workspace. Disk wipes (format X:, diskpart,
 * Format-Volume, Clear-Disk, cipher /w, diskutil erase*, mkfs, dd or a redirect onto a raw disk) are always denied.
 * Wrappers are inspected too: sudo/env/nohup prefixes, bash|sh -c, cmd /c, powershell -Command / -EncodedCommand,
 * Invoke-Expression, eval, wsl, $(...) and backticks, chained with ; && || | and newlines.
 *
 * Workspace: payload workspacePaths[0]/cwd, else the command's own absolute Cwd. A workspace that is a drive root,
 * the home folder or an ancestor of it protects nothing and counts as unknown. With no workspace, only relative
 * targets below the current folder are allowed (`rm -rf build`); absolute, home, `..` and whole-folder globs are denied.
 * Targets that are only known at run time (variables other than home/pwd, command substitution, unknown pipeline input,
 * a `cd` to an unknown folder) are denied.
 *
 * Safety guard: no config or environment switch. Fail-closed: an inspection error or an unparseable shell payload
 * that mentions a delete command is denied.
 */
import os from 'node:os';
import path from 'node:path';
import { readStdin } from './read-stdin.mjs';
import { resolveWorkspace } from './workspace-path.mjs';
import { isMainModule } from './is-main.mjs';

const STDIN_WAIT_MS = 1500;
const MAX_DEPTH = 8;
const COMMAND_KEY = /^(?:command|cmd|command_?line|script)$/i;
const CWD_KEY = /^(?:cwd|workdir|working_?dir(?:ectory)?|directory)$/i;
/** Delete or wipe vocabulary; used only to fail closed when a payload cannot be analysed. */
export const DELETE_HINT = /\b(?:rm|srm|rmdir|rd|del|erase|remove-item|ri|diskpart|format-volume|clear-disk|wipefs|mkfs|newfs|rmtree|rmsync|rimraf)\b|-delete\b|\bformat\s+["']?[a-z]:|\bdiskutil\s+\S*(?:erase|zero|random|partition|reformat)|\bcipher\b[^\n]*\/w|\brobocopy\b[^\n]*\/(?:mir|purge)\b|\brsync\b[^\n]*--delete/i;
const DEVICE = /^(?:\/dev\/(?:r?disk\d|sd[a-z]|hd[a-z]|vd[a-z]|xvd[a-z]|nvme\d|mmcblk\d)|\\\\\.\\(?:physicaldrive\d|[a-z]:))/i;
const DELETE_VERBS = new Set(['rm', 'srm', 'remove-item', 'ri', 'del', 'erase', 'rd', 'rmdir']);
const SHELLS = new Set(['bash', 'sh', 'zsh', 'dash', 'ksh', 'mksh', 'ash', 'fish']);
const POWERSHELLS = new Set(['powershell', 'pwsh', 'powershell_ise']);
const KEYWORDS = new Set(['!', '{', '}', 'then', 'do', 'else', 'elif', 'if', 'while', 'until', 'time', 'exec', 'command', 'builtin', 'nohup', 'noglob', 'call', 'busybox']);
const OPTION_PREFIXES = { sudo: /^-[ugpCUDhrtT]$/, doas: /^-[uC]$/, env: /^-[uCS]$/, nice: /^-n$/, ionice: /^-[cnp]$/, stdbuf: /^-[ioe]$/, timeout: /^-[sk]$/, caffeinate: /^-[tw]$/ };
const ALLOW = Object.freeze({ decision: 'allow' });

// ---------- tokenising ----------

/**
 * Split a command line into words and operators. `posix`: sh quoting and backslash escapes. `win`: cmd and
 * PowerShell together — backslash is a path separator, backtick and caret escape, '' inside single quotes.
 * Command substitutions are returned in `subs` and leave a `$(…)` placeholder (`$PWD` for a bare pwd).
 */
function tokenize(src, dialect) {
	const win = dialect === 'win';
	const items = [];
	const subs = [];
	let word = '';
	let started = false;
	let incomplete = false;
	const flush = () => {
		if (started) items.push(word);
		word = '';
		started = false;
	};
	const op = value => {
		flush();
		items.push({ op: value });
	};
	// Index of the ')' closing a '(' that ends just before `start`, or -1.
	const closing = start => {
		let depth = 1;
		let quote = '';
		for (let j = start; j < src.length; j++) {
			const c = src[j];
			if (quote) {
				if (c === quote) quote = '';
				else if (c === '\\' && !win && quote === '"') j++;
				continue;
			}
			if (c === '"' || c === "'") quote = c;
			else if (c === '(') depth++;
			else if (c === ')' && --depth === 0) return j;
		}
		return -1;
	};
	const substitution = inner => {
		subs.push(inner);
		return /^\s*(?:pwd|get-location|gl)\s*$/i.test(inner) ? '$PWD' : '$(…)';
	};
	let i = 0;
	while (i < src.length) {
		const c = src[i];
		if (c === "'") {
			let j = i + 1;
			let closed = false;
			for (; j < src.length; j++) {
				if (src[j] === "'") {
					if (win && src[j + 1] === "'") {
						word += "'";
						j++;
						continue;
					}
					closed = true;
					break;
				}
				word += src[j];
			}
			started = true;
			if (!closed) {
				incomplete = true;
				break;
			}
			i = j + 1;
			continue;
		}
		if (c === '"') {
			let j = i + 1;
			let closed = false;
			for (; j < src.length; j++) {
				const d = src[j];
				if (d === '"') {
					closed = true;
					break;
				}
				if (!win && d === '\\' && /["\\$`\n]/.test(src[j + 1] || '')) {
					j++;
					if (src[j] !== '\n') word += src[j];
				} else if (win && d === '`' && j + 1 < src.length) word += src[++j];
				else if (d === '$' && src[j + 1] === '(') {
					const end = closing(j + 2);
					if (end < 0) break;
					word += substitution(src.slice(j + 2, end));
					j = end;
				} else if (!win && d === '`') {
					const end = src.indexOf('`', j + 1);
					if (end < 0) break;
					word += substitution(src.slice(j + 1, end));
					j = end;
				} else word += d;
			}
			started = true;
			if (!closed) {
				incomplete = true;
				break;
			}
			i = j + 1;
			continue;
		}
		if (!win && c === '\\') {
			started = true;
			if (src[i + 1] === '\n') i += 2;
			else if (i + 1 < src.length) {
				word += src[i + 1];
				i += 2;
			} else {
				word += c;
				i++;
			}
			continue;
		}
		if (win && (c === '`' || c === '^') && i + 1 < src.length) {
			if (!/[\r\n]/.test(src[i + 1])) {
				word += src[i + 1];
				started = true;
			}
			i += 2;
			continue;
		}
		if (c === '$' && src[i + 1] === '(') {
			const end = closing(i + 2);
			if (end < 0) {
				incomplete = true;
				break;
			}
			word += substitution(src.slice(i + 2, end));
			started = true;
			i = end + 1;
			continue;
		}
		if (c === '$' && src[i + 1] === '{') {
			const end = src.indexOf('}', i + 2);
			if (end < 0) {
				incomplete = true;
				break;
			}
			word += src.slice(i, end + 1);
			started = true;
			i = end + 1;
			continue;
		}
		if (!win && c === '`') {
			const end = src.indexOf('`', i + 1);
			if (end < 0) {
				incomplete = true;
				break;
			}
			word += substitution(src.slice(i + 1, end));
			started = true;
			i = end + 1;
			continue;
		}
		if (c === '#' && !started) {
			while (i < src.length && src[i] !== '\n') i++;
			continue;
		}
		if (c === '\n' || c === '\r' || c === ';' || c === '(' || c === ')' || (win && (c === '{' || c === '}'))) {
			op(';');
			i++;
			continue;
		}
		if (/\s/.test(c)) {
			flush();
			i++;
			continue;
		}
		if (c === '|') {
			if (src[i + 1] === '|') {
				op('||');
				i += 2;
			} else {
				op('|');
				i += src[i + 1] === '&' ? 2 : 1;
			}
			continue;
		}
		if (c === '&') {
			if (src[i + 1] === '&') {
				op('&&');
				i += 2;
			} else if (src[i + 1] === '>') {
				op('>');
				i += src[i + 2] === '>' ? 3 : 2;
			} else {
				op(';');
				i++;
			}
			continue;
		}
		if (c === '>' || c === '<') {
			if (started && /^(?:\d+|\*)$/.test(word)) {
				word = '';
				started = false;
			}
			flush();
			let j = i + 1;
			if (src[j] === c) j++;
			if (src[j] === '&') {
				j++;
				while (/[\d-]/.test(src[j] || '')) j++;
				items.push({ op: '>&' });
			} else items.push({ op: c });
			i = j;
			continue;
		}
		word += c;
		started = true;
		i++;
	}
	flush();
	return { items, subs, incomplete };
}

/** Group tokens into pipelines of argv arrays; redirect targets are returned separately. */
function statements(items) {
	const pipelines = [];
	const redirects = [];
	let pipe = [];
	let argv = [];
	let redirect = false;
	const endCommand = () => {
		if (argv.length) pipe.push(argv);
		argv = [];
	};
	const endPipeline = () => {
		endCommand();
		if (pipe.length) pipelines.push(pipe);
		pipe = [];
	};
	for (const item of items) {
		if (typeof item === 'string') {
			if (redirect) redirects.push(item);
			else argv.push(item);
			redirect = false;
			continue;
		}
		redirect = item.op === '>' || item.op === '<';
		if (item.op === '|') endCommand();
		else if (!redirect && item.op !== '>&') endPipeline();
	}
	endPipeline();
	return { pipelines, redirects };
}

/** Expand sh brace lists (`{a,b}`); a sequence (`{1..3}`) or a huge expansion yields null (unknown). */
function braceExpand(word) {
	const out = [];
	const stack = [word];
	while (stack.length) {
		const w = stack.pop();
		let expanded = false;
		for (let i = 0; i < w.length && !expanded; i++) {
			if (w[i] !== '{' || w[i - 1] === '$') continue;
			let depth = 0;
			let j = i;
			const commas = [];
			for (; j < w.length; j++) {
				if (w[j] === '{') depth++;
				else if (w[j] === '}' && --depth === 0) break;
				else if (w[j] === ',' && depth === 1) commas.push(j);
			}
			if (j >= w.length) break;
			if (!commas.length) {
				if (w.slice(i, j).includes('..')) return null;
				continue;
			}
			let start = i + 1;
			for (const end of [...commas, j]) {
				stack.push(w.slice(0, i) + w.slice(start, end) + w.slice(j + 1));
				start = end + 1;
			}
			expanded = true;
		}
		if (!expanded) out.push(w);
		if (out.length + stack.length > 64) return null;
	}
	return out;
}

// ---------- paths ----------

function verbOf(token = '') {
	return token.replace(/^[@&]+/, '').split(/[\\/]/).pop().toLowerCase().replace(/\.(?:exe|com|cmd|bat|ps1)$/, '');
}

function key(p, ctx) {
	const resolved = ctx.P.resolve(p);
	return ctx.ci ? resolved.toLowerCase() : resolved;
}

function inside(child, parent, ctx) {
	const prefix = parent.endsWith(ctx.P.sep) ? parent : parent + ctx.P.sep;
	return child !== parent && child.startsWith(prefix);
}

function isRoot(k, ctx) {
	return ctx.P.parse(k).root === k || (ctx.win && /^\\\\[^\\]+\\?$/.test(k));
}

function absolute(p, ctx) {
	if (typeof p !== 'string' || !p) return null;
	if (ctx.win ? !/^(?:[a-z]:[\\/]|\\\\[^\\/])/i.test(p) : !p.startsWith('/')) return null;
	return ctx.P.resolve(p);
}

/** Workspace that actually narrows deletes: not a root, the home folder or an ancestor of it. */
function usableWorkspace(p, ctx) {
	const abs = absolute(p, ctx);
	if (!abs) return null;
	const k = key(abs, ctx);
	if (isRoot(k, ctx) || (ctx.homeKey && (k === ctx.homeKey || inside(ctx.homeKey, k, ctx)))) return null;
	return abs;
}

const HOME_PREFIX = /^(?:~|\$\{?home\}?|\$\{?env:(?:userprofile|home)\}?|%userprofile%|%home%|%homedrive%%homepath%)(?=$|[\\/])/i;
const PWD_PREFIX = /^(?:\$\{?pwd\}?|\$\{?env:pwd\}?|%cd%)(?=$|[\\/])/i;

/**
 * Resolve one target word: { abs } | { rel } (relative, no workspace) | { unknown: 'unknown'|'cwd' }.
 * A glob resolves to the folder it expands in, which is never itself deleted.
 */
function resolveTarget(raw, ctx) {
	const { P, win } = ctx;
	let t = raw;
	if (win) t = t.replace(/^\\\\\?\\UNC\\/i, '\\\\').replace(/^\\\\[?.]\\/, '');
	let anchored = false;
	const home = t.match(HOME_PREFIX);
	if (home) {
		if (!ctx.home) return { unknown: 'unknown' };
		t = ctx.home + t.slice(home[0].length);
		anchored = true;
	} else {
		const pwd = t.match(PWD_PREFIX);
		if (pwd) {
			if (!ctx.cwd) return { unknown: ctx.cwdLost ? 'cwd' : 'unknown' };
			t = ctx.cwd + t.slice(pwd[0].length);
			anchored = true;
		}
	}
	if (/^~|[$`]|%[^%\s]+%/.test(t)) return { unknown: 'unknown' };
	if (win) {
		if (/^[a-z]:$/i.test(t)) t += '\\';
		else if (/^[a-z]:(?![\\/])/i.test(t)) return { unknown: 'unknown' };
	}
	const sep = win ? /[\\/]/ : /\//;
	const glob = /[*?[]/;
	if (glob.test(t)) {
		const parts = t.split(sep);
		const at = parts.findIndex(part => glob.test(part));
		if (parts.slice(at + 1).includes('..')) return { unknown: 'unknown' };
		t = parts.slice(0, at).join(P.sep);
		if (t === '' && at > 0) t = P.sep;
		else if (t === '') t = '.';
		else if (win && /^[a-z]:$/i.test(t)) t += '\\';
		else if (win && /^\\\\[^\\]+$/.test(t)) return { abs: t };
	}
	if (!anchored && !P.isAbsolute(t)) {
		if (ctx.cwd) return { abs: P.resolve(ctx.cwd, t) };
		return ctx.cwdLost ? { unknown: 'cwd' } : { rel: P.normalize(t) };
	}
	if (win && /^[\\/](?![\\/])/.test(t)) return { abs: P.resolve(ctx.cwd || ctx.workspace || ctx.home || 'C:\\', t) };
	if (win && /^\\\\[^\\]+\\?$/.test(t)) return { abs: t };
	return { abs: P.resolve(t) };
}

/** Why deleting `res` (an item, or the contents of a folder) is unsafe, or null. */
function judge(res, kind, ctx) {
	if (res.unknown) return res.unknown;
	if (res.rel !== undefined) return res.rel === '.' || res.rel === '..' || /^\.\.[\\/]/.test(res.rel) ? 'nows' : null;
	const k = key(res.abs, ctx);
	if (isRoot(k, ctx)) return 'root';
	if (ctx.homeKey && (k === ctx.homeKey || inside(ctx.homeKey, k, ctx))) return 'home';
	if (!ctx.wsKey) return 'nows';
	if (k === ctx.wsKey) return kind === 'contents' ? null : 'workspace';
	return inside(k, ctx.wsKey, ctx) ? null : 'outside';
}

function checkTargets(list, ctx, dialect, segment) {
	for (const { raw, kind } of list) {
		if (!raw) continue;
		const words = dialect === 'posix' ? braceExpand(raw) : raw.split(',');
		if (!words) return { why: 'unknown', target: raw, segment };
		for (const word of words) {
			if (!word) continue;
			// A glob deletes entries inside the folder it expands in, never that folder itself.
			const res = resolveTarget(word, ctx);
			const why = judge(res, /[*?[]/.test(word) ? 'contents' : kind, ctx);
			if (why) return { why, target: word, abs: res.abs, segment };
		}
	}
	return null;
}

// ---------- commands ----------

function stripPrefixes(argv) {
	const args = [...argv];
	for (let guard = 0; guard < 32 && args.length; guard++) {
		const verb = verbOf(args[0]);
		if (/^[A-Za-z_]\w*=/.test(args[0]) || args[0] === '@' || KEYWORDS.has(verb)) {
			args.shift();
			continue;
		}
		const valued = OPTION_PREFIXES[verb];
		if (!valued) break;
		args.shift();
		while (args.length && (args[0].startsWith('-') || (verb === 'env' && /^[A-Za-z_]\w*=/.test(args[0])))) {
			const option = args.shift();
			if (option === '--') break;
			if (valued.test(option) && args.length) args.shift();
		}
		if (verb === 'timeout' && args.length) args.shift();
	}
	return args;
}

function deleteArgs(verb, rest) {
	let recursive = false;
	let force = false;
	let endOfOptions = false;
	const targets = [];
	const cmdSwitches = verb === 'del' || verb === 'erase' || verb === 'rd' || verb === 'rmdir';
	for (const a of rest) {
		if (endOfOptions || a === '-' || !/^[-/]/.test(a)) targets.push(a);
		else if (a === '--') endOfOptions = true;
		else if (a.startsWith('/')) {
			if (!cmdSwitches || !/^(?:\/[a-z](?::[^/]*)?)+$/i.test(a)) targets.push(a);
			else for (const s of a.toLowerCase().split('/')) {
				if (s[0] === 's') recursive = true;
				else if (s[0] === 'q' || s[0] === 'f') force = true;
			}
		} else if (a.startsWith('--')) {
			const name = a.slice(2).toLowerCase();
			if (name === 'recursive') recursive = true;
			else if (name === 'force') force = true;
		} else {
			const colon = a.indexOf(':');
			const name = (colon < 0 ? a.slice(1) : a.slice(1, colon)).toLowerCase();
			const value = colon < 0 ? undefined : a.slice(colon + 1);
			const on = value === undefined || !/^\$?false$/i.test(value);
			if (name && 'recurse'.startsWith(name)) recursive ||= on;
			else if (name.length >= 2 && 'force'.startsWith(name)) force ||= on;
			else if (colon < 0 && /^[rRfiIdvPWx]+$/.test(a.slice(1))) {
				if (/r/i.test(a)) recursive = true;
				if (a.includes('f')) force = true;
			} else if (value && !/^\$?(?:true|false)$/i.test(value)) targets.push(value);
		}
	}
	return { recursive, force, targets };
}

function findRoots(rest) {
	let i = 0;
	while (i < rest.length && /^-[HLPEXsxd]$/.test(rest[i])) i++;
	const roots = [];
	while (i < rest.length && !/^[-(!]/.test(rest[i])) roots.push(rest[i++]);
	return roots.length ? roots : ['.'];
}

/** Paths a pipeline feeds to the next command, or null when they cannot be known beforehand. */
function upstreamTargets(upstream) {
	if (!upstream) return null;
	const args = stripPrefixes(upstream);
	const verb = verbOf(args[0]);
	const rest = args.slice(1);
	const operands = rest.filter(a => !a.startsWith('-') && !(verb === 'dir' && /^\/[a-z]/i.test(a)));
	const of = (list, kind) => list.map(raw => ({ raw, kind }));
	if (verb === 'find') return of(findRoots(rest), 'contents');
	if (['ls', 'dir', 'gci', 'get-childitem', 'fd', 'tree'].includes(verb)) return of(operands.length ? operands : ['.'], 'contents');
	if (['gi', 'get-item'].includes(verb)) return of(operands.length ? operands : ['.'], 'item');
	if (['echo', 'printf', 'print', 'write-output', 'write'].includes(verb)) return of(operands, 'item');
	return null;
}

function nested(tokens, dialect, ctx, depth) {
	if (!tokens.length) return null;
	const quote = t => (dialect === 'posix' ? `'${t.replace(/'/g, `'\\''`)}'` : `"${t}"`);
	const text = tokens.length === 1 ? tokens[0] : tokens.map(t => (/[\s"']/.test(t) ? quote(t) : t)).join(' ');
	return analyze(text, dialect, { ...ctx }, depth + 1);
}

function analyzeArgv(argv, dialect, ctx, depth, upstream, viaXargs = false) {
	const args = stripPrefixes(argv);
	// cmd accepts switches glued to the verb: rd/s/q, cmd/c.
	const glued = dialect === 'win' && args.length ? args[0].match(/^@?(rd|rmdir|del|erase|cmd)((?:\/.*)?)$/i) : null;
	if (glued?.[2]) args.splice(0, 1, glued[1], ...glued[2].split(/(?=\/)/));
	if (!args.length) return null;
	const verb = verbOf(args[0]);
	const rest = args.slice(1);
	const segment = argv.join(' ');
	const wipe = () => ({ why: 'wipe', verb, segment });

	if (DELETE_VERBS.has(verb)) {
		const { recursive, force, targets } = deleteArgs(verb, rest);
		if (!(verb === 'rd' || verb === 'rmdir' ? recursive : recursive || force)) return null;
		let list = targets.map(raw => ({ raw, kind: 'item' }));
		if (viaXargs || (!list.length && upstream)) {
			const piped = upstreamTargets(upstream);
			if (!piped) return { why: 'pipe', segment };
			list = list.concat(piped);
		}
		return checkTargets(list, ctx, dialect, segment);
	}
	if (verb === 'xargs') {
		let i = 0;
		const placeholders = new Set();
		while (i < rest.length && rest[i].startsWith('-')) {
			const a = rest[i++];
			if (a === '--') break;
			if (a.startsWith('-I')) placeholders.add(a.length > 2 ? a.slice(2) : rest[i++]);
			else if (a.startsWith('-i') || a.startsWith('--replace')) placeholders.add(a.includes('=') ? a.slice(a.indexOf('=') + 1) : a.length > 2 && a[1] === 'i' ? a.slice(2) : '{}');
			else if (/^-[nPLsdaEe]$/.test(a)) i++;
		}
		const inner = [];
		for (const a of rest.slice(i)) {
			if (placeholders.has(a)) continue;
			let word = a;
			for (const p of placeholders) if (p) word = word.split(p).join('*');
			inner.push(word);
		}
		return inner.length ? analyzeArgv(inner, dialect, ctx, depth, upstream, true) : null;
	}
	if (verb === 'find') {
		let deletes = rest.includes('-delete');
		for (let j = 0; j < rest.length && !deletes; j++) {
			if (!/^-(?:exec|execdir|ok|okdir)$/.test(rest[j])) continue;
			const run = [];
			for (let k = j + 1; k < rest.length && rest[k] !== ';' && rest[k] !== '+'; k++) run.push(rest[k]);
			deletes = DELETE_VERBS.has(verbOf(stripPrefixes(run)[0])) || DELETE_HINT.test(run.join(' '));
		}
		return deletes ? checkTargets(findRoots(rest).map(raw => ({ raw, kind: 'contents' })), ctx, dialect, segment) : null;
	}
	if (verb === 'robocopy' && rest.some(a => /^\/(?:mir|purge)$/i.test(a))) {
		const dest = rest.filter(a => !a.startsWith('/'))[1];
		return dest ? checkTargets([{ raw: dest, kind: 'contents' }], ctx, dialect, segment) : { why: 'unknown', target: '', segment };
	}
	if (verb === 'rsync' && rest.some(a => a.startsWith('--delete'))) {
		const dest = rest.filter(a => !a.startsWith('-')).pop();
		if (!dest) return { why: 'unknown', target: '', segment };
		if (/^[^/\\]*:/.test(dest) && !/^[a-z]:[\\/]/i.test(dest)) return null;
		return checkTargets([{ raw: dest, kind: 'contents' }], ctx, dialect, segment);
	}
	if (verb === 'diskpart' || verb === 'format-volume' || verb === 'clear-disk' || /^(?:mkfs|newfs|mke2fs|wipefs)(?:[._].*)?$/.test(verb)) return wipe();
	if (verb === 'format' && rest.some(a => /^[a-z]:/i.test(a))) return wipe();
	if (verb === 'diskutil' && (/^(?:erase|zero|random|secureerase|partitiondisk|reformat)/i.test(rest[0] || '') || (/^(?:apfs|cs|ar)$/i.test(rest[0] || '') && /delete|erase/i.test(rest[1] || '')))) return wipe();
	if (verb === 'cipher' && rest.some(a => /^\/w(?::|$)/i.test(a))) return wipe();
	if (verb === 'dd' && rest.some(a => /^of=/i.test(a) && DEVICE.test(a.slice(3)))) return wipe();
	if (verb === 'shred' && rest.some(a => DEVICE.test(a))) return wipe();

	if (['cd', 'chdir', 'pushd', 'set-location', 'sl', 'push-location', 'popd', 'pop-location'].includes(verb)) {
		const operands = rest.filter(a => !(a.startsWith('-') && a !== '-') && !/^\/d$/i.test(a));
		let target = operands[0];
		if (verb === 'popd' || verb === 'pop-location' || target === '-') target = '$OLDPWD';
		if (target === undefined) {
			if (dialect === 'win') return null;
			target = '~';
		}
		const res = resolveTarget(target, ctx);
		ctx.cwd = res.abs ?? null;
		ctx.cwdLost = !res.abs;
		return null;
	}
	if (SHELLS.has(verb)) {
		const at = rest.findIndex(a => /^-[a-z]*c[a-z]*$/i.test(a));
		if (at >= 0) return rest[at + 1] === undefined ? null : analyze(rest[at + 1], 'posix', { ...ctx }, depth + 1);
		if (rest.some(a => !a.startsWith('-')) || !upstream) return null;
		const feeder = stripPrefixes(upstream);
		if (!['echo', 'printf'].includes(verbOf(feeder[0]))) return null;
		return analyze(feeder.slice(1).filter(a => !a.startsWith('-')).join(' '), 'posix', { ...ctx }, depth + 1);
	}
	if (verb === 'cmd') {
		const at = rest.findIndex(a => /^\/[ck]$/i.test(a));
		return at >= 0 ? nested(rest.slice(at + 1), 'win', ctx, depth) : null;
	}
	if (POWERSHELLS.has(verb)) {
		const name = a => (a.startsWith('-') || a.startsWith('/') ? a.slice(1).toLowerCase() : '');
		const at = rest.findIndex(a => name(a) && 'command'.startsWith(name(a)));
		if (at >= 0) return nested(rest.slice(at + 1), 'win', ctx, depth);
		const enc = rest.findIndex(a => name(a) && ('encodedcommand'.startsWith(name(a)) || name(a) === 'ec'));
		if (enc >= 0) return rest[enc + 1] ? analyze(Buffer.from(rest[enc + 1], 'base64').toString('utf16le'), 'win', { ...ctx }, depth + 1) : null;
		if (rest.some(a => name(a) && 'file'.startsWith(name(a)))) return null;
		const valued = /^(?:ep|ex|exe|exec|execu|execut|executi|executio|execution|executionp\w*|w|wi|win|wind\w*|v|ve|ver\w*|conf\w*|cus\w*|o|of|ou|out\w*|if|inp\w*|psc\w*|wd|wo|work\w*|settings\w*)$/;
		let i = 0;
		while (i < rest.length && name(rest[i])) i += valued.test(name(rest[i])) ? 2 : 1;
		return nested(rest.slice(i), 'win', ctx, depth);
	}
	if (verb === 'iex' || verb === 'invoke-expression') return nested(rest.filter(a => !/^-c(?:o(?:m(?:m(?:a(?:n(?:d)?)?)?)?)?)?$/i.test(a)), 'win', ctx, depth);
	if (verb === 'eval') return nested(rest, 'posix', ctx, depth);
	if (verb === 'wsl') {
		let i = 0;
		while (i < rest.length && rest[i].startsWith('-')) {
			const a = rest[i++];
			if (a === '--') break;
			if (/^(?:-d|--distribution|-u|--user|--cd|--shell-type)$/.test(a)) i++;
		}
		return nested(rest.slice(i), 'posix', ctx, depth);
	}
	return null;
}

function analyze(command, dialect, ctx, depth) {
	if (depth > MAX_DEPTH) return DELETE_HINT.test(command) ? { why: 'parse', segment: command } : null;
	const { items, subs, incomplete } = tokenize(command, dialect);
	if (incomplete && DELETE_HINT.test(command)) return { why: 'parse', segment: command };
	for (const sub of subs) {
		const finding = analyze(sub, dialect, { ...ctx }, depth + 1);
		if (finding) return finding;
	}
	const { pipelines, redirects } = statements(items);
	const device = redirects.find(r => DEVICE.test(r));
	if (device) return { why: 'wipe', verb: '>', target: device, segment: command };
	for (const pipe of pipelines) {
		for (let n = 0; n < pipe.length; n++) {
			const finding = analyzeArgv(pipe[n], dialect, ctx, depth, n ? pipe[n - 1] : null);
			if (finding) return finding;
		}
	}
	return null;
}

// ---------- verdicts ----------

function clip(text, max = 160) {
	const s = String(text ?? '').replace(/\s+/g, ' ').trim();
	return s.length > max ? `${s.slice(0, max)}…` : s;
}

const BY_HAND = '탐색기(Windows)나 Finder(macOS)에서 직접 확인하고 손으로 지우세요.';

function explain(f, ctx) {
	const command = clip(f.segment);
	if (f.why === 'wipe') {
		return `디스크를 포맷하거나 통째로 지우는 명령을 막았습니다: "${command}". 이런 명령(${f.verb})은 디스크 전체를 되돌릴 수 없게 지울 수 있어 항상 막습니다. 꼭 필요하면 디스크 관리(Windows)나 디스크 유틸리티(macOS)에서 직접 확인하고 실행하세요.`;
	}
	if (f.why === 'parse') {
		return `삭제 명령이 들어 있는데 명령을 끝까지 해석할 수 없어 안전을 위해 막았습니다: "${command}". 명령을 짧고 단순하게 나눠 다시 실행하세요. 작업 폴더 밖을 지워야 하면 ${BY_HAND}`;
	}
	const named = f.target ? `'${clip(f.target, 80)}'` : '지울 대상';
	const target = f.target && f.abs && f.abs !== f.target ? `${named}(실제 위치 ${f.abs})` : named;
	const where = ctx.workspace ? `작업 폴더(${ctx.workspace})` : '작업 폴더';
	const why = {
		root: `${target}은(는) 드라이브 전체(맨 위 폴더)를 가리킵니다.`,
		home: `${target}은(는) 사용자 폴더 전체이거나 그보다 위 폴더입니다.`,
		workspace: `${target}은(는) ${where} 전체입니다.`,
		outside: `${target}은(는) ${where} 밖에 있습니다.`,
		nows: `작업 폴더를 알 수 없어 ${target}이(가) 안전한 위치인지 확인할 수 없습니다.`,
		unknown: `${target}에 변수나 명령 결과처럼 실행해야만 정해지는 부분이 있어 실제로 어디를 지우는지 미리 확인할 수 없습니다.`,
		cwd: `명령 안에서 현재 폴더를 바꿔 ${target}의 실제 위치를 확인할 수 없습니다.`,
		pipe: '지울 대상을 앞 명령의 결과로 넘겨받아 무엇을 지우는지 미리 확인할 수 없습니다.',
	}[f.why];
	return `위험한 삭제 명령을 막았습니다: "${command}". ${why} 이 명령은 그 안의 파일을 되돌릴 수 없게 모두 지울 수 있습니다. ${where} 안에서 지울 파일이나 폴더 이름을 정확히 적어 다시 지우세요. 그 밖의 위치를 꼭 지워야 하면 ${BY_HAND}`;
}

function context({ workspace, cwd, home, platform } = {}) {
	const p = platform ?? process.platform;
	const win = p === 'win32';
	const ctx = { platform: p, win, P: win ? path.win32 : path.posix, ci: win || p === 'darwin', cwdLost: false };
	ctx.home = absolute(home ?? os.homedir(), ctx);
	ctx.homeKey = ctx.home ? key(ctx.home, ctx) : null;
	ctx.workspace = usableWorkspace(workspace, ctx) ?? usableWorkspace(cwd, ctx);
	ctx.wsKey = ctx.workspace ? key(ctx.workspace, ctx) : null;
	const base = absolute(cwd, ctx);
	ctx.cwd = base ?? (typeof cwd === 'string' && cwd && ctx.workspace ? ctx.P.resolve(ctx.workspace, cwd) : ctx.workspace);
	return ctx;
}

function denied(finding, ctx) {
	return { decision: 'deny', reason: explain(finding, ctx), ...(finding.target ? { target: finding.target } : {}) };
}

/**
 * Verdict for one shell command (string, or an argv array) run in `cwd` (default: the workspace).
 * Options: workspace, cwd, home (default os.homedir()), platform (default process.platform).
 */
export function checkCommand(command, options = {}) {
	const ctx = context(options);
	const text = Array.isArray(command) ? command.join(' ') : String(command ?? '');
	try {
		const dialect = ctx.win ? 'win' : 'posix';
		const finding = Array.isArray(command) ? analyzeArgv(command.map(String), dialect, ctx, 0, null) : analyze(text, dialect, ctx, 0);
		return finding ? denied(finding, ctx) : ALLOW;
	} catch {
		return DELETE_HINT.test(text) ? denied({ why: 'parse', segment: text }, ctx) : ALLOW;
	}
}

function parseJson(text) {
	if (typeof text !== 'string') return undefined;
	const t = text.trim();
	if (!t.startsWith('{') && !t.startsWith('[') && !t.startsWith('"')) return undefined;
	try {
		return JSON.parse(t);
	} catch {
		return undefined;
	}
}

function isShellTool(name) {
	const semantic = String(name || '').split('__').at(-1).replace(/([a-z])([A-Z])/g, '$1_$2');
	return /(?:^|_)(?:run|exec|execute|command|bash|shell|terminal|powershell|cmd)(?:_|$)/i.test(semantic);
}

function collectCommands(node, found, depth, cwd) {
	if (depth > MAX_DEPTH) {
		if (DELETE_HINT.test(JSON.stringify(node) ?? '')) found.overflow = true;
		return;
	}
	if (typeof node === 'string') {
		const parsed = parseJson(node);
		if (parsed && typeof parsed === 'object') collectCommands(parsed, found, depth + 1, cwd);
		return;
	}
	if (Array.isArray(node)) {
		for (const item of node) collectCommands(item, found, depth + 1, cwd);
		return;
	}
	if (!node || typeof node !== 'object') return;
	const own = Object.entries(node).find(([k, v]) => CWD_KEY.test(k) && typeof v === 'string');
	const here = own ? own[1] : cwd;
	for (const [k, v] of Object.entries(node)) {
		const argv = Array.isArray(v) && v.length && v.every(x => typeof x === 'string');
		if (COMMAND_KEY.test(k) && (typeof v === 'string' || argv)) found.list.push({ command: v, cwd: here });
		else if (v && typeof v === 'object') collectCommands(v, found, depth + 1, here);
		else if (typeof v === 'string' && /^\s*[{[]/.test(v)) collectCommands(v, found, depth + 1, here);
	}
}

/**
 * Verdict for a hook payload. `payload` is the parsed JSON (undefined when `raw` is not JSON).
 * Shapes: toolCall.{name,args|arguments}, tool_name + tool_input, input/args/parameters, or flat command keys.
 */
export function inspectPayload(payload, raw = '', options = {}) {
	const text = typeof raw === 'string' ? raw : '';
	const parseDenied = segment => denied({ why: 'parse', segment }, context(options));
	if (payload === undefined || typeof payload === 'string') {
		const body = typeof payload === 'string' ? payload : text;
		return body.trim() && DELETE_HINT.test(body) ? parseDenied(body) : ALLOW;
	}
	if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return ALLOW;
	try {
		const shell = isShellTool(payload.tool_name ?? payload.toolCall?.name ?? payload.name);
		let args = payload.toolCall?.args ?? payload.toolCall?.arguments ?? payload.tool_input ?? payload.input ?? payload.args ?? payload.arguments ?? payload.parameters;
		if (args == null && Object.keys(payload).some(k => COMMAND_KEY.test(k))) args = payload;
		if (args == null) return shell && DELETE_HINT.test(text || JSON.stringify(payload)) ? parseDenied(text || JSON.stringify(payload)) : ALLOW;
		if (typeof args === 'string') {
			const parsed = parseJson(args);
			if (!parsed || typeof parsed !== 'object') return shell && DELETE_HINT.test(args) ? parseDenied(args) : ALLOW;
			args = parsed;
		}
		const found = { list: [], overflow: false };
		collectCommands(args, found, 0, undefined);
		if (found.overflow) return parseDenied(text || JSON.stringify(args));
		const workspace = resolveWorkspace(payload, null);
		for (const { command, cwd } of found.list) {
			const verdict = checkCommand(command, { ...options, workspace, cwd });
			if (verdict.decision === 'deny') return verdict;
		}
		if (!found.list.length && shell && DELETE_HINT.test(JSON.stringify(args))) return parseDenied(JSON.stringify(args));
		return ALLOW;
	} catch {
		return DELETE_HINT.test(text) ? parseDenied(text) : ALLOW;
	}
}

function allow() {
	process.stdout.write('{}\n');
	process.exit(0);
}

function deny(reason) {
	console.error(`[DESTRUCTIVE GUARD] BLOCKED: ${reason}`);
	process.stdout.write(`${JSON.stringify({ decision: 'deny', reason })}\n`);
	process.exit(1);
}

async function main() {
	let raw = '';
	try {
		raw = process.env.ANTIGRAVITY_TOOL_INPUT || process.env.TOOL_INPUT || (await readStdin(STDIN_WAIT_MS));
		const verdict = inspectPayload(parseJson(raw), raw);
		if (verdict.decision === 'deny') deny(verdict.reason);
	} catch {
		if (DELETE_HINT.test(raw)) deny(explain({ why: 'parse', segment: raw }, context()));
	}
	allow();
}

if (isMainModule(import.meta.url)) main();
