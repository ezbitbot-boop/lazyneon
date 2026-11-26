#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { isMainModule } from './is-main.mjs';
import { samePath } from './same-path.mjs';
import { settings } from './settings.mjs';

import {acquireUpdateLock} from './update-lock.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const DAY = 24 * 60 * 60 * 1000;
function git(dir, args, deadline = Infinity) {
 const remaining=deadline-Date.now();
 if(remaining<=0) throw Error('Session update budget exhausted');
 const r = spawnSync('git', ['-C', dir, ...args], {
  encoding: 'utf8', timeout: Math.min(5000,remaining),
  env: {...process.env, GIT_TERMINAL_PROMPT: '0', GIT_OPTIONAL_LOCKS: '0'},
 });
 if (r.error || r.signal || r.status !== 0) throw Error(r.error?.message || r.stderr?.trim() || 'git failed');
 return r.stdout.trim();
}
function checkout(dir, deadline) {
 const top=git(dir,['rev-parse','--show-toplevel'],deadline);
 if(!samePath(top,dir)) throw Error('Update requires plugin root to equal Git top-level');
 if (git(dir, ['symbolic-ref', '--short', 'HEAD'],deadline) !== 'main') throw Error('Update requires branch main');
 git(dir, ['remote', 'get-url', 'origin'],deadline);
 return git(dir, ['rev-parse', 'HEAD'],deadline);
}
function fetchHead(dir, deadline) {
 git(dir, ['fetch', '--no-tags', '--no-recurse-submodules', 'origin', 'refs/heads/main'],deadline);
 return git(dir, ['rev-parse', 'FETCH_HEAD'],deadline);
}
// --no-overwrite-ignore: the clean check does not see ignored files, so a
// fast-forward must never replace an ignored local file (e.g. config/issuer.json).
function fastForward(dir, after, deadline) {
 try { git(dir, ['merge', '--ff-only', '--no-overwrite-ignore', after], deadline); }
 catch (error) {
  if (/would be overwritten|untracked working tree files/i.test(error.message)) throw Error(`Update would overwrite ignored local files; move them aside and retry:\n${error.message}`);
  throw error;
 }
}
function clean(dir, deadline) {
 if (git(dir, ['status', '--porcelain', '--untracked-files=all'],deadline)) throw Error('Local changes present; commit or remove them before updating');
}
export function updateCommand(dir = root) {
 const cli = join(dir, 'bin', 'lazyneon');
 // POSIX single quoting also protects spaces, apostrophes and shell expansions.
 return process.platform === 'win32' ? `node "${cli.replaceAll('"', '')}" update` : `node '${cli.replaceAll("'", "'\\''")}' update`;
}
export function updatePlugin(dir = root, env = process.env, out = process.stdout) {
 if (settings(env, dir).offline) throw Error('offline mode (LAZYNEON_OFFLINE=1 or "offline": true in config/local.json): update disabled');
 const before = checkout(dir);
 clean(dir);
 const after = fetchHead(dir);
 const log = git(dir, ['log', '--format=%h %s', `${before}..${after}`]);
 out.write(`LazyNeon changelog ${before.slice(0,7)} → ${after.slice(0,7)}\n${log || '(no new commits)'}\n`);
 // Recheck after the network operation; never stash, reset, rebase or force.
 clean(dir);
 if (git(dir, ['rev-parse', 'HEAD']) !== before) throw Error('HEAD changed during update; retry');
 fastForward(dir, after);
 out.write(`LazyNeon updated ${before.slice(0,7)}..${after.slice(0,7)}\n`);
}

// The return value is injected into SessionStart, not merely printed to stderr.
export function autoUpdate(dir = root, env = process.env, errOut = process.stderr) {
 const switches = settings(env, dir);
 if (switches.offline || !switches.updateCheck) return;
 let release;
 const deadline=Date.now()+12000;
 try {
  const before = checkout(dir,deadline);
  const state = join(git(dir, ['rev-parse', '--absolute-git-dir'],deadline), 'lazyneon-last-update-check');
  // Exclusive lock prevents simultaneous SessionStart processes from double checking.
  release=acquireUpdateLock(`${state}.lock`);
  if(!release) return;
  try {
   const timestamp = Number(readFileSync(state, 'utf8'));
   if (Number.isFinite(timestamp) && Date.now() - timestamp < DAY) return;
  } catch {}
  // If we cannot record the throttle, do not make an unthrottled network request.
  writeFileSync(state, String(Date.now()));
  const after = fetchHead(dir,deadline);
  const count = git(dir, ['rev-list', '--count', `${before}..${after}`],deadline);
  if (count === '0') return;
  const command = updateCommand(dir);
  if (env.LAZYNEON_AUTO_UPDATE === '1') {
   try {
    clean(dir,deadline);
    if (git(dir, ['rev-parse', 'HEAD'],deadline) !== before) throw Error('local commits differ');
    fastForward(dir, after, deadline);
    errOut.write(`LazyNeon updated ${before.slice(0,7)}..${after.slice(0,7)} (${count} commits)\n`);
    return;
   } catch (error) {
    const reason = /local changes/i.test(error.message) ? 'local changes present' : /ignored local files/i.test(error.message) ? 'ignored local files would be overwritten' : 'local commits differ';
    errOut.write(`LazyNeon: ${count} updates on origin/main; ${reason}, not auto-updated. Run: ${command}\n`);
   }
  }
  return `LazyNeon update available: ${before.slice(0,7)} → ${after.slice(0,7)} (${count} commits). Run: ${command}`;
 } catch { /* A failed check must not prevent a session from starting. */ }
 finally { release?.(); }
}
if (isMainModule(import.meta.url)) {
 try { updatePlugin(); } catch (error) { console.error(error.message); process.exitCode = 1; }
}
