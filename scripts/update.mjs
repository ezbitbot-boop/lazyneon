#!/usr/bin/env node
import { readFileSync, writeFileSync, openSync, closeSync, unlinkSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { isMainModule } from './is-main.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const DAY = 24 * 60 * 60 * 1000;
function git(dir, args) {
 const r = spawnSync('git', ['-C', dir, ...args], {
  encoding: 'utf8', timeout: 5000,
  env: {...process.env, GIT_TERMINAL_PROMPT: '0', GIT_OPTIONAL_LOCKS: '0'},
 });
 if (r.error || r.signal || r.status !== 0) throw Error(r.error?.message || r.stderr?.trim() || 'git failed');
 return r.stdout.trim();
}
function checkout(dir) {
 if (git(dir, ['symbolic-ref', '--short', 'HEAD']) !== 'main') throw Error('Update requires branch main');
 git(dir, ['remote', 'get-url', 'origin']);
 return git(dir, ['rev-parse', 'HEAD']);
}
function fetchHead(dir) {
 git(dir, ['fetch', '--no-tags', '--no-recurse-submodules', 'origin', 'refs/heads/main']);
 return git(dir, ['rev-parse', 'FETCH_HEAD']);
}
function clean(dir) {
 if (git(dir, ['status', '--porcelain', '--untracked-files=all'])) throw Error('Local changes present; commit or remove them before updating');
}
export function updateCommand(dir = root) {
 const cli = join(dir, 'bin', 'lazyneon');
 // POSIX single quoting also protects spaces, apostrophes and shell expansions.
 return process.platform === 'win32' ? `node "${cli.replaceAll('"', '')}" update` : `node '${cli.replaceAll("'", "'\\''")}' update`;
}
export function updatePlugin(dir = root, env = process.env, out = process.stdout) {
 if (env.LAZYNEON_OFFLINE === '1') throw Error('LAZYNEON_OFFLINE=1: update disabled');
 const before = checkout(dir);
 clean(dir);
 const after = fetchHead(dir);
 const log = git(dir, ['log', '--format=%h %s', `${before}..${after}`]);
 out.write(`LazyNeon changelog ${before.slice(0,7)} → ${after.slice(0,7)}\n${log || '(no new commits)'}\n`);
 // Recheck after the network operation; never stash, reset, rebase or force.
 clean(dir);
 if (git(dir, ['rev-parse', 'HEAD']) !== before) throw Error('HEAD changed during update; retry');
 git(dir, ['merge', '--ff-only', after]);
 out.write(`LazyNeon updated ${before.slice(0,7)}..${after.slice(0,7)}\n`);
}

// The return value is injected into SessionStart, not merely printed to stderr.
export function autoUpdate(dir = root, env = process.env, errOut = process.stderr) {
 if (env.LAZYNEON_OFFLINE === '1' || env.LAZYNEON_NO_UPDATE_CHECK === '1' || env.LAZYNEON_NO_AUTO_UPDATE === '1') return;
 let lock;
 try {
  const before = checkout(dir);
  const state = join(git(dir, ['rev-parse', '--absolute-git-dir']), 'lazyneon-last-update-check');
  // Exclusive lock prevents simultaneous SessionStart processes from double checking.
  lock = `${state}.lock`;
  let fd;
  try { fd = openSync(lock, 'wx'); } catch { lock = undefined; return; }
  closeSync(fd);
  try {
   const timestamp = Number(readFileSync(state, 'utf8'));
   if (Number.isFinite(timestamp) && Date.now() - timestamp < DAY) return;
  } catch {}
  // If we cannot record the throttle, do not make an unthrottled network request.
  writeFileSync(state, String(Date.now()));
  const after = fetchHead(dir);
  const count = git(dir, ['rev-list', '--count', `${before}..${after}`]);
  if (count === '0') return;
  const command = updateCommand(dir);
  if (env.LAZYNEON_AUTO_UPDATE === '1') {
   try {
    clean(dir);
    if (git(dir, ['rev-parse', 'HEAD']) !== before) throw Error('local commits differ');
    git(dir, ['merge', '--ff-only', after]);
    errOut.write(`LazyNeon updated ${before.slice(0,7)}..${after.slice(0,7)} (${count} commits)\n`);
    return;
   } catch (error) {
    const reason = /local changes/i.test(error.message) ? 'local changes present' : 'local commits differ';
    errOut.write(`LazyNeon: ${count} updates on origin/main; ${reason}, not auto-updated. Run: ${command}\n`);
   }
  }
  return `LazyNeon update available: ${before.slice(0,7)} → ${after.slice(0,7)} (${count} commits). Run: ${command}`;
 } catch { /* A failed check must not prevent a session from starting. */ }
 finally { if (lock) { try { unlinkSync(lock); } catch {} } }
}
if (isMainModule(import.meta.url)) {
 try { updatePlugin(); } catch (error) { console.error(error.message); process.exitCode = 1; }
}
