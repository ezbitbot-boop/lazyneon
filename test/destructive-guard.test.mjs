import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { checkCommand, inspectPayload } from '../scripts/destructive_guard.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SCRIPT = path.join(ROOT, 'scripts', 'destructive_guard.mjs');

// Explicit platform/home/workspace: every form below runs on every OS.
const POSIX = { platform: 'linux', home: '/Users/analyst', workspace: '/Users/analyst/cases/case1' };
const MAC = { ...POSIX, platform: 'darwin' };
const WIN = { platform: 'win32', home: 'C:\\Users\\analyst', workspace: 'C:\\Users\\analyst\\cases\\case1' };
const encoded = text => Buffer.from(text, 'utf16le').toString('base64');

const POSIX_DENY = [
	'rm -rf /', 'rm -rf /*', 'rm -rf "/"', "rm -rf '/'", 'rm -Rf /', 'rm -rf --no-preserve-root /',
	'rm -rf ~', 'rm -rf ~/', 'rm -rf ~/*', 'rm -rf $HOME', 'rm -rf "${HOME}"', 'rm -rf /Users/analyst', 'rm -rf /Users',
	'rm -r -f /etc', 'rm --recursive --force /tmp/x', 'rm -fr ..', 'rm -rf ../case2', 'rm -rf .', 'rm -rf /Users/analyst/cases',
	'rm -rf /tmp/scratch', 'rm -rf build/*/../../..', 'rm -rf {build,/}', 'rm -f /etc/hosts',
	'sudo rm -rf /', 'sudo -u root rm -rf ~', 'env FOO=1 nice -n 5 rm -rf /', 'timeout 10 rm -rf ~', 'nohup rm -rf / &',
	'echo / | xargs rm -rf', 'xargs rm -rf < list.txt', 'cat list.txt | xargs rm -rf', 'find / -delete', 'find ~ -name x -exec rm -rf {} +',
	"bash -c 'rm -rf ~'", 'sh -c "rm -rf /"', "zsh -lc 'cd / && rm -rf usr'", 'echo "rm -rf /" | sh', 'eval "rm -rf ~"',
	'ls; rm -rf /', 'true && rm -rf ~', 'false || rm -rf /', 'cat x | rm -rf /', 'ls\nrm -rf /', '(rm -rf /)', '{ rm -rf ~; }',
	'if true; then rm -rf /; fi', 'echo $(rm -rf ~)', 'echo `rm -rf /`',
	'rm -rf $FOO', 'rm -rf "$TARGET/x"', 'rm -rf $(pwd)/..', 'rm -rf `echo /`', 'rm -rf {1..3}',
	'cd / && rm -rf usr', 'cd .. && rm -rf case1', 'cd && rm -rf Documents', 'rsync -a --delete empty/ ~/',
	'diskutil eraseDisk APFS X disk2', 'dd if=/dev/zero of=/dev/disk2', 'cat /dev/zero > /dev/disk2', 'mkfs.ext4 /dev/sdb1',
];
const POSIX_ALLOW = [
	'rm -rf ./build', 'rm -rf node_modules', 'rm -rf build dist', 'rm file.txt', 'rm -f a.txt b.txt', 'ls -la', 'git status',
	'rm -rf *', 'rm -rf *.log', 'rm -rf "$HOME/cases/case1/build"', 'rm -rf $(pwd)/build', 'rm -rf /Users/analyst/cases/case1/out',
	'find . -name "*.tmp" -delete', 'ls | xargs rm -rf', 'cd build && rm -rf out', 'rm /etc/hosts', 'rmdir /tmp/x',
	'rm -rf build 2>/dev/null', 'echo "rm -rf /"', 'git rm -r --cached x', 'rm -rf build # cleanup /', "bash -c 'rm -rf dist'",
];
const WIN_DENY = [
	'rd /s /q \\', 'RD /S /Q C:\\', 'rd /s /q C:', 'rd/s/q \\', 'rd /s /q \\\\server\\share', 'rmdir /s D:\\data', 'rmdir /S /Q C:/',
	'del /s /q C:\\*', 'erase /s C:\\Users', 'del /q c:\\users\\ANALYST', 'del /s /q ..\\..\\*',
	'Remove-Item -Recurse -Force C:\\', 'Remove-Item -Recurse -Force C:/', 'Remove-Item -Recurse -Force C:\\*', 'Remove-Item -Recurse -Force C:*',
	'Remove-Item -Rec -Fo ~', 'ri -r -fo $env:USERPROFILE', 'rm -r -fo %USERPROFILE%', 'Remove-Item -Recurse -Force ${env:USERPROFILE}',
	'Remove-Item -Path C:\\ -Recurse', 'Remove-Item -LiteralPath:C:\\ -Recurse', 'remove-item -recurse -force c:\\USERS\\analyst\\CASES',
	'Remove-Item -Recurse -Force ..\\..', 'Remove-Item -Recurse -Force \\\\server\\share', 'Remove-Item -Recurse -Force build, C:\\',
	'Remove-Item -Recurse -Force $env:TEMP\\x', 'Get-ChildItem C:\\ | Remove-Item -Recurse -Force', 'cd \\; rd /s /q Windows',
	'cmd /c "rd /s /q \\"', 'cmd.exe /C rd /S /Q C:\\', 'C:\\Windows\\System32\\cmd.exe /c "rd /s /q \\"',
	'powershell -Command "Remove-Item -Recurse -Force C:\\"', 'pwsh -NoProfile -ExecutionPolicy Bypass -Command "& { Remove-Item -Recurse -Force C:\\ }"',
	`powershell -EncodedCommand ${encoded('Remove-Item -Recurse -Force C:\\')}`, 'iex "Remove-Item -Recurse -Force ~"',
	"bash -c 'rm -rf ~'", 'dir && rd /s /q \\', 'echo hi | rd /s /q C:\\',
	'format C: /q', 'format D:', 'diskpart', 'Format-Volume -DriveLetter D', 'Clear-Disk -Number 1', 'cipher /w:C:\\',
	'robocopy empty C:\\Users\\analyst /MIR',
];
const WIN_ALLOW = [
	'Remove-Item -Recurse -Force .\\dist', 'Remove-Item -Recurse -Force -ErrorAction SilentlyContinue .\\dist', 'rm -rf ./build',
	'del report.tmp', 'del /q *.tmp', 'rd /s /q build', 'Remove-Item -Recurse -Force C:\\Users\\analyst\\cases\\case1\\out',
	'Remove-Item -Recurse -Force c:\\users\\analyst\\cases\\case1\\OUT', 'Remove-Item -Recurse -Force "$HOME\\cases\\case1\\x"',
	'Get-ChildItem .\\build | Remove-Item -Recurse -Force', 'cmd /c "rd /s /q build"', 'git status', 'dir', 'rmdir C:\\empty',
	'Remove-Item .\\x -Recurse:$false',
];

for (const [label, options, commands, decision] of [
	['POSIX', POSIX, POSIX_DENY, 'deny'], ['POSIX', POSIX, POSIX_ALLOW, 'allow'],
	['Windows', WIN, WIN_DENY, 'deny'], ['Windows', WIN, WIN_ALLOW, 'allow'],
]) {
	test(`${label} forms are ${decision === 'deny' ? 'denied' : 'allowed'} on every OS`, () => {
		for (const command of commands) assert.equal(checkCommand(command, options).decision, decision, command);
	});
}

test('the reported rd /s /q \\ case names the drive root in plain Korean', () => {
	const verdict = checkCommand('rd /s /q \\', WIN);
	assert.equal(verdict.decision, 'deny');
	assert.match(verdict.reason, /rd \/s \/q \\/);
	assert.match(verdict.reason, /C:\\/);
	assert.match(verdict.reason, /드라이브 전체/);
	assert.match(verdict.reason, /탐색기/);
	assert.match(verdict.reason, /Finder/);
	assert.match(checkCommand('rm -rf ~', POSIX).reason, /사용자 폴더/);
	assert.match(checkCommand('rm -rf /tmp/x', POSIX).reason, /작업 폴더\(\/Users\/analyst\/cases\/case1\) 밖/);
	assert.match(checkCommand('format C:', WIN).reason, /항상 막습니다/);
});

test('macOS paths compare case-insensitively; Linux paths do not', () => {
	assert.equal(checkCommand('rm -rf /USERS/ANALYST', MAC).decision, 'deny');
	assert.equal(checkCommand('rm -rf /users/analyst/cases/CASE1/out', MAC).decision, 'allow');
	assert.equal(checkCommand('rm -rf /users/analyst/cases/CASE1/out', POSIX).decision, 'deny');
});

test('the command working folder resolves relative targets; workspace stays the boundary', () => {
	const sub = { ...POSIX, cwd: '/Users/analyst/cases/case1/sub' };
	assert.equal(checkCommand('rm -rf ../out', sub).decision, 'allow');
	assert.equal(checkCommand('rm -rf ../../case2', sub).decision, 'deny');
	assert.equal(checkCommand('rm -rf build', { ...POSIX, cwd: '/opt' }).decision, 'deny');
	assert.equal(checkCommand(['bash', '-lc', 'rm -rf ~'], POSIX).decision, 'deny');
	assert.equal(checkCommand(['rm', '-rf', 'build'], POSIX).decision, 'allow');
});

test('unknown or too-broad workspace: only relative targets below the current folder are allowed', () => {
	for (const options of [{ platform: 'linux', home: '/Users/analyst' }, { ...POSIX, workspace: '/Users/analyst' }, { ...POSIX, workspace: '/' }]) {
		assert.equal(checkCommand('rm -rf build', options).decision, 'allow');
		assert.equal(checkCommand('rm -rf build/*', options).decision, 'allow');
		for (const command of ['rm -rf *', 'rm -rf .', 'rm -rf ..', 'rm -rf ../x', 'rm -rf /opt/x', 'rm -rf ~/Documents', 'cd /opt && rm -rf x']) {
			assert.equal(checkCommand(command, options).decision, 'deny', command);
		}
	}
	const win = { platform: 'win32', home: 'C:\\Users\\analyst' };
	assert.equal(checkCommand('rd /s /q build', win).decision, 'allow');
	assert.equal(checkCommand('rd /s /q \\', win).decision, 'deny');
	assert.equal(checkCommand('Remove-Item -Recurse -Force D:\\data', win).decision, 'deny');
	// Falls back to the command's own absolute working folder.
	assert.equal(checkCommand('rm -rf build', { platform: 'linux', home: '/Users/analyst', cwd: '/work/case' }).decision, 'allow');
	assert.equal(checkCommand('rm -rf /work/other', { platform: 'linux', home: '/Users/analyst', cwd: '/work/case' }).decision, 'deny');
});

test('payload shapes: toolCall, tool_name/tool_input, flat args, JSON-string args, argv arrays', () => {
	const ws = POSIX.workspace;
	const options = { platform: 'linux', home: POSIX.home };
	for (const [payload, decision] of [
		[{ toolCall: { name: 'run_command', args: { CommandLine: 'rm -rf /', Cwd: ws } }, workspacePaths: [ws] }, 'deny'],
		[{ toolCall: { name: 'run_command', args: { CommandLine: 'rm -rf build', Cwd: ws } }, workspacePaths: [ws] }, 'allow'],
		[{ toolCall: { name: 'run_command', arguments: JSON.stringify({ CommandLine: 'rm -rf ~' }) }, workspacePaths: [ws] }, 'deny'],
		[{ tool_name: 'Bash', tool_input: { command: 'rm -rf build' }, cwd: ws }, 'allow'],
		[{ tool_name: 'Bash', tool_input: { command: 'rm -rf ../..' }, cwd: ws }, 'deny'],
		[{ command: 'rm -rf /' }, 'deny'],
		[{ CommandLine: 'rm -rf build', Cwd: ws }, 'allow'],
		[{ toolCall: { name: 'exec_command', args: { cmd: ['bash', '-lc', 'rm -rf ~'], workdir: ws } } }, 'deny'],
		[{ toolCall: { name: 'write_file', args: { Path: 'x.sh', Content: 'rm -rf /' } } }, 'allow'],
		[{ toolCall: { name: 'apply_patch', args: '*** Add File: x.sh\n+rm -rf /' } }, 'allow'],
		[{ toolCall: { name: 'read_file', args: { Path: '/etc/hosts' } } }, 'allow'],
		[{}, 'allow'],
		// Fail-closed: shell tool whose command cannot be located or parsed.
		[{ toolCall: { name: 'run_command', args: 'rm -rf /' } }, 'deny'],
		[{ toolCall: { name: 'run_command', args: { argv: 'rm -rf build' } } }, 'deny'],
		// In sh quoting `\"` escapes the quote, so this is unterminated: fail closed.
		[{ toolCall: { name: 'run_command', args: { command_line: 'cmd /c "rd /s /q \\"' } }, workspacePaths: [ws] }, 'deny'],
		[{ toolCall: { name: 'run_command', args: { CommandLine: 'rm -rf "unterminated' } }, workspacePaths: [ws] }, 'deny'],
	]) {
		assert.equal(inspectPayload(payload, JSON.stringify(payload), options).decision, decision, JSON.stringify(payload));
	}
	// Windows dialect: backslash is a path separator, so the same wrapper parses and names the drive root.
	const win = { toolCall: { name: 'run_command', args: { CommandLine: 'cmd /c "rd /s /q \\"' } }, workspacePaths: [WIN.workspace] };
	assert.equal(inspectPayload(win, JSON.stringify(win), { platform: 'win32', home: WIN.home }).decision, 'deny');
	for (const [raw, decision] of [['{broken rm -rf /', 'deny'], ['{broken', 'allow'], ['', 'allow'], ['plain text', 'allow']]) {
		assert.equal(inspectPayload(undefined, raw, options).decision, decision, raw);
	}
});

test('hooks.json registers destructive_guard after write_chunk_guard for every tool', () => {
	const pre = JSON.parse(fs.readFileSync(path.join(ROOT, 'hooks.json'), 'utf8')).hooks.PreToolUse;
	const entry = pre.find(group => group.hooks.some(h => h.command === 'node ./scripts/destructive_guard.mjs'));
	assert.ok(entry, 'destructive_guard registered');
	assert.equal(entry.matcher, '.*');
	assert.deepEqual(entry.hooks.map(h => h.command), ['node ./scripts/write_chunk_guard.mjs', 'node ./scripts/destructive_guard.mjs']);
	assert.equal(entry.hooks[1].timeout, 30);
	assert.doesNotMatch(fs.readFileSync(SCRIPT, 'utf8'), /process\.env\.LAZYNEON|settings\(/, 'no switch');
});

// ---------- spawned hook ----------

const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'destructive-guard-'));
process.on('exit', () => fs.rmSync(sandbox, { recursive: true, force: true }));
const HOME = path.join(sandbox, 'home');
const WORKSPACE = path.join(HOME, 'cases', 'case1');
fs.mkdirSync(WORKSPACE, { recursive: true });
const ENV = (() => {
	const env = { ...process.env, HOME, USERPROFILE: HOME, LAZYNEON_OFFLINE: '1', LAZYNEON_NO_AUTO_UPDATE: '1' };
	delete env.ANTIGRAVITY_TOOL_INPUT;
	delete env.TOOL_INPUT;
	return env;
})();
const runCommand = CommandLine => ({ conversationId: 'dg', workspacePaths: [WORKSPACE], toolCall: { name: 'run_command', args: { CommandLine, Cwd: WORKSPACE } } });
const hook = (input, env = {}) => spawnSync(process.execPath, [SCRIPT], { cwd: ROOT, input, encoding: 'utf8', env: { ...ENV, ...env }, timeout: 10000 });

function assertDenied(result, pattern) {
	assert.equal(result.status, 1, result.stderr);
	const output = JSON.parse(result.stdout);
	assert.equal(output.decision, 'deny');
	assert.match(output.reason, pattern);
	assert.match(result.stderr, /^\[DESTRUCTIVE GUARD\] BLOCKED: /);
}

function assertAllowed(result) {
	assert.equal(result.status, 0, result.stderr);
	assert.equal(result.stdout, '{}\n');
}

test('spawned hook denies drive-root and home wipes and allows workspace cleanup', () => {
	assertDenied(hook(JSON.stringify(runCommand('rm -rf /'))), /드라이브 전체/);
	assertDenied(hook(JSON.stringify(runCommand('rm -rf ~'))), /사용자 폴더/);
	assertDenied(hook(JSON.stringify(runCommand('ls && rm -rf ..'))), /작업 폴더/);
	if (process.platform === 'win32') {
		assertDenied(hook(JSON.stringify(runCommand('rd /s /q \\'))), /드라이브 전체/);
		assertDenied(hook(JSON.stringify(runCommand('Remove-Item -Recurse -Force $env:USERPROFILE'))), /사용자 폴더/);
		assertAllowed(hook(JSON.stringify(runCommand('Remove-Item -Recurse -Force .\\dist'))));
	}
	assertAllowed(hook(JSON.stringify(runCommand('rm -rf ./build'))));
	assertAllowed(hook(JSON.stringify(runCommand('git status'))));
	assertAllowed(hook(JSON.stringify({ toolCall: { name: 'write_file', args: { Path: 'notes.md', Content: 'rm -rf /' } } })));
	assertAllowed(hook(''));
});

test('spawned hook reads ANTIGRAVITY_TOOL_INPUT and has no off switch', () => {
	assertDenied(hook('', { ANTIGRAVITY_TOOL_INPUT: JSON.stringify(runCommand('rm -rf /')) }), /드라이브 전체/);
	assertDenied(hook('', { TOOL_INPUT: JSON.stringify({ CommandLine: 'rm -rf ~' }) }), /사용자 폴더/);
	const config = path.join(sandbox, 'local.json');
	fs.writeFileSync(config, JSON.stringify({ writeChunkGuard: false, destructiveGuard: false }));
	assertDenied(hook(JSON.stringify(runCommand('rm -rf /')), { LAZYNEON_CONFIG: config, LAZYNEON_DISABLE_WRITE_CHUNK_GUARD: '1', LAZYNEON_DISABLE_DESTRUCTIVE_GUARD: '1' }), /드라이브 전체/);
});

test('spawned hook fails closed on a malformed payload that mentions a delete', () => {
	assertDenied(hook('{"toolCall":{"name":"run_command","args":{"CommandLine":"rm -rf /'), /해석할 수 없어/);
	assertDenied(hook(JSON.stringify({ toolCall: { name: 'run_command', args: 'rm -rf build' } })), /해석할 수 없어/);
	assertAllowed(hook('{"toolCall":{"name":"run_command","args":{"CommandLine":"ls'));
});

function runOpen(payload) {
	return new Promise(resolve => {
		const started = Date.now();
		const child = spawn(process.execPath, [SCRIPT], { cwd: ROOT, env: ENV });
		let stdout = '';
		child.stdout.setEncoding('utf8').on('data', chunk => { stdout += chunk; });
		if (payload !== null) child.stdin.write(payload);
		const timer = setTimeout(() => child.kill(), 8000);
		child.on('close', status => {
			clearTimeout(timer);
			child.stdin.destroy();
			resolve({ status, stdout, ms: Date.now() - started });
		});
	});
}

test('spawned hook answers and exits while the host keeps stdin open', async () => {
	const denied = await runOpen(JSON.stringify(runCommand('rm -rf /')));
	assert.equal(denied.status, 1);
	assert.equal(JSON.parse(denied.stdout).decision, 'deny');
	assert.ok(denied.ms < 4000, `${denied.ms}ms`);
	const silent = await runOpen(null);
	assert.equal(silent.status, 0);
	assert.equal(silent.stdout, '{}\n');
	assert.ok(silent.ms < 4000, `${silent.ms}ms`);
});
