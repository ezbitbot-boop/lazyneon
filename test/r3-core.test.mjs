import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { hookTargets } from '../scripts/hook_targets.mjs';
import { resolveWorkspaceCwd } from '../scripts/session_start.mjs';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = f => fs.readFileSync(path.join(root, f), 'utf8');
const env = { ...process.env, LAZYNEON_OFFLINE: '1', LAZYNEON_NO_AUTO_UPDATE: '1', PYTHONDONTWRITEBYTECODE: '1' };
function tmp(t) { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'neon-r3-')); t.after(() => fs.rmSync(d, {recursive:true, force:true})); return d; }
function run(script, args=[], payload={}, cwd=root) { return spawnSync(process.execPath, [script,...args], {cwd,input:JSON.stringify(payload),encoding:'utf8',env,timeout:20000}); }

test('R3 M1 node_modules is absent and ignored as a file or directory', t => {
 const dir=tmp(t);
 const init=spawnSync('git',['init',dir],{encoding:'utf8'});assert.equal(init.status,0,init.stderr);
 fs.copyFileSync(path.join(root,'.gitignore'),path.join(dir,'.gitignore'));
 assert.equal(fs.lstatSync(path.join(root,'node_modules'), {throwIfNoEntry:false}), undefined);
 const r = spawnSync('git', ['check-ignore','--no-index','node_modules','node_modules/example'], {cwd:dir,encoding:'utf8'});
 assert.equal(r.status,0,r.stderr); assert.deepEqual(r.stdout.trim().split('\n'),['node_modules','node_modules/example']);
});
for (const [script,args,payload] of [
 ['json_schema_guard.mjs',[],{toolCall:{name:'write_file',args:{TargetFile:'broken.json'}}}],
 ['session_start.mjs',[],{}], ['classify-task.mjs',['review'],{}],
 ['stop_claim_guard.mjs',[],{}], ['codegraph.mjs',['handoff','--root','source'],{}],
 ['selfcheck_stats.mjs',['--help'],{}], ['upstream_radar.mjs',['audit','--json'],{}],
 ['lsp_diagnostics.mjs',['--help'],{}],
]) test(`R3 M2 linked entry ${script}`, t => {
 const d=tmp(t); const link=path.join(d,'linked'); fs.symlinkSync(root,link,process.platform==='win32'?'junction':'dir');
 fs.mkdirSync(path.join(d,'source')); fs.writeFileSync(path.join(d,'broken.json'),'{bad'); const p={...payload,cwd:d};
 const real=run(path.join(root,'scripts',script),args,p,d); const linked=run(path.join(link,'scripts',script),args,p,d);
 assert.equal(linked.status,real.status,linked.stderr); assert.ok(linked.stdout+linked.stderr,'entry must execute');
 assert.equal(linked.stdout,real.stdout); assert.equal(linked.stderr,real.stderr);
 if(script==='json_schema_guard.mjs') { assert.equal(linked.status,1); assert.match(linked.stderr,/FAIL/); }
 if(script==='session_start.mjs') assert.ok(JSON.parse(linked.stdout).injectSteps.length);
});
test('R3 M4 smoke validates the repository skill inventory', () => {
 const r=spawnSync(process.platform==='win32'?'python':'python3',['tools/smoke_test.py'],{cwd:root,encoding:'utf8',env,timeout:120000});
 assert.equal(r.status,0,r.stdout+r.stderr);
 assert.doesNotMatch(read('tools/smoke_test.py'),/len\(skill_dirs\)\s*==\s*\d+/);
});
test('R3 L1 README states opt-in update and disabling precedence', () => {
 const s=read('README.md'); assert.match(s,/기본 꺼짐/); assert.match(s,/LAZYNEON_AUTO_UPDATE=1/); assert.match(s,/LAZYNEON_OFFLINE=1.*LAZYNEON_NO_AUTO_UPDATE=1.*우선/);
});
test('R3 L2 current titles and receipt targets retain source records', () => {
 for(const f of ['docs/keyword-routing.md','docs/material-first-design.md','docs/SKILL-SOURCES.md']) assert.doesNotMatch(read(f).split('\n')[0],/LazyArgon/i);
 const receipts=JSON.parse(read('docs/skill-source-receipts.json'));
 assert.ok(receipts.sources.length>0); assert.doesNotMatch(JSON.stringify(receipts),/\.\.\/lazyargon-workspace/);
 assert.doesNotMatch(read('docs/SKILL-SOURCES.md'),/\.\.\/lazyargon-workspace/);
});
test('R3 L4 core hook test makes no fictitious workspace assertion', () => {
 const s=read('test/hooks-guards.test.mjs'); assert.doesNotMatch(s,/CORE_ROOT = ROOT|wsHooks|both hooks\.json|workspace PreToolUse/);
 assert.match(s,/core registers stop_claim_guard and the warn-only reply_format_guard, each once/);
});
test('R3 L5 tests only use Node 20.0 compatible module paths', () => {
 for(const f of fs.readdirSync(path.join(root,'test')).filter(f=>f.endsWith('.mjs'))) assert.ok(!read(`test/${f}`).includes('import.meta.'+'dirname'),f);
});
test('R3 L6 portable test command and Windows installation instructions', () => {
 assert.equal(JSON.parse(read('package.json')).scripts.test,'node scripts/run-tests.mjs');
 const s=read('README.md'); assert.match(s,/\$env:LAZYNEON_OFFLINE\s*=\s*['"]1['"]/); assert.match(s,/set "LAZYNEON_OFFLINE=1"/); assert.match(s,/node bin\/lazyneon doctor/);
});
test('R3 L6 Windows RPC diagnostics explain platform support', async () => {
 const { liveRpcSkipReason } = await import('../scripts/doctor-runtime.mjs');
 assert.match(liveRpcSkipReason('win32',true,false),/Windows.*미지원/);
 assert.match(liveRpcSkipReason('linux',true,true),/LAZYNEON_OFFLINE/);
});
test('R3 H1 workspacePaths takes precedence and relative workspace is rejected', t => {
 const d=tmp(t), other=path.join(d,'other'); fs.mkdirSync(other);
 const p={workspacePaths:[d],cwd:other,toolCall:{args:{path:'broken.json'}}};
 assert.equal(resolveWorkspaceCwd(p),d); assert.deepEqual(hookTargets([{parsed:p}]),[path.join(d,'broken.json')]);
 assert.equal(resolveWorkspaceCwd({workspacePaths:['relative'],cwd:other}),other);
});
test('R3 H1 lookup ledger uses workspacePaths ahead of cwd', t => {
 const d=tmp(t), other=path.join(d,'other'); fs.mkdirSync(other); const transcript=path.join(d,'transcript.jsonl');
 fs.writeFileSync(transcript,[{type:'USER_INPUT',content:'search'},{type:'PLANNER_RESPONSE',tool_calls:[{name:'grep_search',args:{query:'missing'}}]},{type:'GENERIC',step_index:2,content:'No results found'}].map(JSON.stringify).join('\n'));
 const r=run(path.join(root,'scripts/lookup_guard.mjs'),[],{cwd:other,workspacePaths:[d],conversationId:'r3',transcriptPath:transcript});
 assert.equal(r.status,0,r.stderr); assert.ok(fs.existsSync(path.join(d,'.lazyneon/lookups.jsonl'))); assert.ok(!fs.existsSync(path.join(other,'.lazyneon')));
});
test('R3 L6 doctor rejects unsupported Python and accepts supported versions', async () => {
 const { pythonVersionStatus } = await import('../scripts/doctor-runtime.mjs');
 for(const version of ['Python 2.7.18','Python 3.9.6','store alias']) assert.equal(pythonVersionStatus(version),'warn');
 for(const version of ['Python 3.10.0','Python 3.12.7','Python 4.0.0']) assert.equal(pythonVersionStatus(version),'ok');
 assert.match(read('README.md'),/Python 3\.10/);
 assert.match(read('scripts/doctor.mjs'),/pythonVersionStatus\(/);
});
test('R3 H1 stop observation uses workspacePaths ahead of cwd', t => {
 const d=tmp(t), other=path.join(d,'other'); fs.mkdirSync(other);
 const r=spawnSync(process.execPath,[path.join(root,'scripts/stop_claim_guard.mjs')],{encoding:'utf8',env:{...env,LAZYNEON_STOP_GUARD:'observe',LAZYNEON_SELF_CHECK:'off'},input:JSON.stringify({workspacePaths:[d],cwd:other,last_assistant_message:'모든 검증을 100% 완벽하게 완료했습니다.'})});
 assert.equal(r.status,0,r.stderr); assert.ok(fs.existsSync(path.join(d,'.lazyneon/stop-guard.jsonl'))); assert.ok(!fs.existsSync(path.join(other,'.lazyneon')));
});
test('R3 M2 unresolved entry fails loudly while imports stay inert', async () => {
 const { isMainModule } = await import('../scripts/is-main.mjs');
 assert.throws(()=>isMainModule(import.meta.url,path.join(root,'missing-entry.mjs')),/Cannot resolve main module/);
 assert.equal(isMainModule(import.meta.url,null),false);
 assert.equal(isMainModule(import.meta.url,path.join(root,'scripts/session_start.mjs')),false);
});
