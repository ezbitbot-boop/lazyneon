import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import cp from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import { getAction, isGate, sessionNotice } from '../scripts/classify-task.mjs';
import { autoUpdate } from '../scripts/session_start.mjs';
const root = process.cwd();
const routing = JSON.parse(fs.readFileSync('skills/ulw/references/model-routing.json'));
const env = { ...process.env, LAZYNEON_OFFLINE:'1', LAZYNEON_NO_AUTO_UPDATE:'1' };
function run(script, payload={}, args=[], extra={}) {
 return cp.spawnSync(process.execPath, [path.join(root,'scripts',script), ...args], {input:JSON.stringify(payload),encoding:'utf8',env:{...env,...extra}});
}
function fixture(t) {
 const dir=fs.mkdtempSync(path.join(root,'.r1-test-'));
 t.after(()=>fs.rmSync(dir,{recursive:true,force:true})); return dir;
}
test('R1 all gate tiers start high with evidenced promotion available',()=>{
 for(const role of Object.keys(routing.roles).filter(r=>isGate(routing.roles,r))) {
 assert.equal(routing.roles[role].model,'gemini-4-neon-high',role);
 assert.equal(routing.roles[role].fallback,'gemini-4-neon-high',role);
 }
});
test('R2 unknown and forbidden sessions delegate or refuse',()=>{
 for(const model of [null,'gemini-4-neon','gemini-4-hydrogen-high','gemini-4-argon-high','gemini-4-carbon-high']) {
 assert.match(getAction(routing.roles.verdict_review.model,routing.roles,'verdict_review','single',{},model),model === null || model === 'gemini-4-neon' ? /^proceed/ : /^refuse:/);
 }
 assert.match(sessionNotice('gemini-4-neon-high',routing.roles,null),/unknown/);
 for(const model of ['gemini-4-argon-high','gemini-4-carbon-high']) assert.match(getAction('gemini-4-neon-high',routing.roles,'default','single',{},model),/^refuse:/);
 const clean={...env}; for(const key of ['ANTIGRAVITY_MODEL_NAME','ANTIGRAVITY_MODEL','GEMINI_MODEL']) delete clean[key];
 clean.ANTIGRAVITY_MODEL_NAME='unknown';
 const r=cp.spawnSync(process.execPath,['scripts/classify-task.mjs','review and audit'],{encoding:'utf8',env:clean});
 assert.match(JSON.parse(r.stdout).session_notice,/unknown/);
});
test('R3 fabricated hashes and self cited artifacts cannot prove completion',t=>{
 const dir=fixture(t);
 for(const [i,steps] of [[],[{type:'USER_INPUT',content:'ghost.md'}],[{type:'PLANNER_RESPONSE',content:'완료. 생성 ghost.md'}],[{type:'PLANNER_RESPONSE',tool_calls:[{name:'write_file',args:{path:'ghost.md'}}]},{type:'GENERIC',status:'ERROR',content:'failed ghost.md'}]].entries()) {
 const transcript=path.join(dir,`t${i}.jsonl`); fs.writeFileSync(transcript,steps.map(s=>JSON.stringify(s)).join('\n'));
 for(const message of ['완료. deadbeef','완료. 생성 ghost.md','완료. ghost.md','완료. ```made up```']) {
 const r=run('stop_claim_guard.mjs',{cwd:dir,conversationId:`case${i}`,transcriptPath:transcript,last_assistant_message:message},[],{LAZYNEON_STOP_GUARD:'enforce',LAZYNEON_SELF_CHECK:'off'});
 assert.equal(JSON.parse(r.stdout).decision,'continue',message);
 }
 }
});
function dispatch(payload, dir) {
 const hooks=JSON.parse(fs.readFileSync('hooks.json')).hooks.PostToolUse;
 for(const group of hooks.filter(g=>new RegExp(g.matcher).test(payload.toolCall.name))) for(const h of group.hooks) {
 const args=h.command.split(' ').slice(2); run('post_tool_feedback.mjs',payload,args,{LAZYNEON_FEEDBACK_DIR:dir});
 }
 return JSON.parse(run('post_tool_feedback.mjs',payload,['inject'],{LAZYNEON_FEEDBACK_DIR:dir}).stdout);
}
test('R4 dispatcher checks patch and every multi edit target in either order',t=>{
 const dir=fixture(t); fs.writeFileSync(path.join(dir,'bad.json'),'{'); fs.writeFileSync(path.join(dir,'bad.md'),'```\nunfinished');
 for(const ext of ['json','md']) for(const form of ['patch','forward','reverse']) {
 const edits=[{path:path.join(dir,'ok.ts')},{path:path.join(dir,`bad.${ext}`)}]; if(form==='reverse') edits.reverse();
 const payload={conversationId:`${ext}-${form}`,cwd:dir,toolCall:{name:form==='patch'?'apply_patch':'multi_edit',args:form==='patch'?{patch:`*** Begin Patch\n*** Update File: ${path.join(dir,`bad.${ext}`)}\n+x\n*** End Patch`}:{edits}}};
 assert.match(JSON.stringify(dispatch(payload,dir)),/GUARD/,`${ext} ${form}`);
 }
});
test('R5 failed lookup is injected before the next invocation',t=>{
 const dir=fixture(t); const tp=path.join(dir,'transcript.jsonl');
 fs.writeFileSync(tp,[{type:'USER_INPUT',content:'search'},{type:'PLANNER_RESPONSE',tool_calls:[{name:'grep_search',args:{query:'missing'}}]},{type:'GENERIC',step_index:2,content:'No results found'}].map(JSON.stringify).join('\n'));
 assert.match(JSON.stringify(dispatch({cwd:dir,conversationId:'lookup',transcriptPath:tp,toolCall:{name:'grep_search',args:{query:'missing'}}},dir)),/LOOKUP GUARD/);
});
test('R6 object JSON string and freeform patches have the same limit',()=>{
 const patch='*** Begin Patch\n*** Add File: unused.txt\n'+'+x\n'.repeat(260)+'*** End Patch';
 for(const args of [{patch},JSON.stringify({patch}),patch]) assert.equal(JSON.parse(run('write_chunk_guard.mjs',{toolCall:{name:'apply_patch',args}}).stdout).decision,'deny');
 assert.equal(JSON.parse(run('write_chunk_guard.mjs',{tool_input:patch}).stdout).decision,'deny');
});
test('R7 explicit missing unreadable files fail and hook paths use workspace',t=>{
 const dir=fixture(t);
 for(const [script,ext] of [['json_schema_guard.mjs','json'],['markdown_structure_guard.mjs','md']]) {
 assert.equal(run(script,{},['--check',path.join(dir,`missing.${ext}`)]).status,1);
 const f=path.join(dir,`denied.${ext}`); fs.writeFileSync(f,ext==='json'?'{}':'valid'); fs.chmodSync(f,0);
 try {assert.equal(run(script,{},['--check',f]).status,1);} finally {fs.chmodSync(f,0o600);}
 fs.writeFileSync(path.join(dir,`bad.${ext}`),ext==='json'?'{':'```\nunfinished');
 assert.equal(run(script,{workspacePaths:[dir],toolCall:{name:'write_file',args:{path:`bad.${ext}`}}}).status,1);
 }
 assert.equal(run('json_schema_guard.mjs',{},['--check',dir]).status,1);
});
test('R8 offline mock RPC is labelled and never live ok',()=>{
 const r=run('doctor.mjs',{},['--json'],{LAZYNEON_LS_RPC_MOCK_JSON:JSON.stringify({states:[{name:'lazyneon/skills/ulw',status:'STATUS_ENABLED'}]})});
 const c=JSON.parse(r.stdout).checks.find(c=>c.id==='antigravity.live_rpc');
 assert.equal(c.source,'mock'); assert.notEqual(c.status,'ok'); assert.doesNotMatch(c.detail,/실시간 로더 정상/);
});
test('R9 merges require opt in, default checks refs, and offline always wins',t=>{
 const dir=fixture(t);
 const original=cp.spawnSync; const calls=[];
 cp.spawnSync=(cmd,args)=>{
  calls.push(args);
  const stdout=args.includes('--show-toplevel')?root:args.includes('symbolic-ref')?'main\n':args.includes('remote')?'origin\n':args.includes('--absolute-git-dir')?dir:args.includes('rev-parse')?(args.includes('HEAD')?'a'.repeat(40):'b'.repeat(40)):args.includes('rev-list')?'1\n':'';
  return {status:0,stdout,stderr:''};
 }; syncBuiltinESMExports();
 try {
 for(const settings of [{LAZYNEON_AUTO_UPDATE:'1',LAZYNEON_OFFLINE:'1'},{LAZYNEON_AUTO_UPDATE:'1',LAZYNEON_NO_UPDATE_CHECK:'1'},{LAZYNEON_AUTO_UPDATE:'1',LAZYNEON_NO_AUTO_UPDATE:'1'}]) {calls.length=0;autoUpdate(root,settings,{write(){}});assert.equal(calls.length,0,JSON.stringify(settings));}
 for(const settings of [{},{LAZYNEON_AUTO_UPDATE:'0'}]) {
  fs.writeFileSync(path.join(dir,'lazyneon-last-update-check'),'0');
  calls.length=0;const notice=autoUpdate(root,settings,{write(){}});
  assert.match(notice,/LazyNeon update available:/);
  assert.equal(calls.filter(args=>args.includes('fetch')).length,1);
  assert.equal(calls.filter(args=>args.includes('merge')).length,0);
 }
 fs.writeFileSync(path.join(dir,'lazyneon-last-update-check'),'0');
 calls.length=0;autoUpdate(root,{LAZYNEON_AUTO_UPDATE:'1'},{write(){}});assert.equal(calls.filter(args=>args.includes('fetch')).length,1);assert.equal(calls.filter(args=>args.includes('merge')).length,1);
 } finally {cp.spawnSync=original;syncBuiltinESMExports();}
});

test('R5 inline failed lookup is relayed without waiting for transcript',t=>{
 const dir=fixture(t);
 assert.match(JSON.stringify(dispatch({cwd:dir,conversationId:'inline',toolCall:{name:'grep_search',args:{query:'missing'}},tool_response:{content:'No results found'}},dir)),/LOOKUP GUARD/);
});
test('R2b Argon/Carbon sessions delegate to Neon when a Neon tier exists, refuse otherwise', () => {
 for (const model of ['gemini-4-argon-high', 'gemini-4-carbon-xhigh']) {
  assert.match(getAction('gemini-4-neon-high', routing.roles, 'default', 'single', routing.subagent_tiers, model), /^delegate: invoke_subagent gemini-4-neon-high/);
  assert.match(getAction('gemini-4-neon-high', routing.roles, 'default', 'single', {}, model), /^refuse:/);
  assert.match(getAction(routing.roles.security_audit.model, routing.roles, 'security_audit', 'single', routing.subagent_tiers, model), /^delegate: invoke_subagent gemini-4-neon-high/);
 }
});

test('R7 high-4 executes high baseline once and collects its verdict for every gate', async () => {
 const { executeGate } = await import('../scripts/classify-task.mjs');
 for (const role of Object.keys(routing.roles).filter(r => isGate(routing.roles, r))) {
  const calls = [];
  const verdict = { model: 'gemini-4-neon-high', status: 'passed', evidence: ['checked'] };
  const result = await executeGate(routing.roles, role, async model => {
   calls.push(model);
   return verdict;
  });
  assert.deepEqual(calls, ['gemini-4-neon-high'], role);
  assert.equal(result.status, 'passed');
  assert.deepEqual(result.verdict, verdict);
  assert.equal(result.attempts.length, 1);
 }
});
test('R7 high-4 refuses failed or substituted gate results', async () => {
 const { executeGate } = await import('../scripts/classify-task.mjs');
 for (const second of [null, { status: 'failed' }, { status: 'unavailable' }, { model: 'gemini-4-neon-high', status: 'passed' }, ...['hydrogen', 'carbon'].map(f => ({ model: `gemini-4-${f}-high`, status: 'passed', evidence: ['fake'] }))]) {
  const calls = [];
  const result = await executeGate(routing.roles, 'plan', async model => {
   calls.push(model);
   return second;
  });
  assert.deepEqual(calls, ['gemini-4-neon-high']);
  assert.equal(result.status, 'refused');
 }
 const unavailable = await executeGate(routing.roles, 'plan', async () => { throw new Error('unavailable'); });
 assert.equal(unavailable.status, 'refused');
 assert.equal(unavailable.attempts.length, 1);
 for (const family of ['hydrogen', 'carbon']) {
  const calls = [];
  const roles = { ...routing.roles, plan: { ...routing.roles.plan, fallback: `gemini-4-${family}-high` } };
  const result = await executeGate(roles, 'plan', async model => { calls.push(model); return { status: 'unavailable' }; });
  assert.equal(result.status, 'refused');
  assert.deepEqual(calls, ['gemini-4-neon-high']);
 }
 const calls = [];
 const failed = await executeGate(routing.roles, 'plan', async model => { calls.push(model); return { model, status: 'failed', evidence: ['defect'] }; });
 assert.equal(failed.status, 'refused');
 assert.deepEqual(calls, ['gemini-4-neon-high'], 'a negative verdict must not be retried into a pass');
 const passed = await executeGate(routing.roles, 'plan', async model => ({ model, status: 'passed', evidence: ['checked'] }));
 assert.equal(passed.status, 'passed');
 assert.equal(passed.attempts.length, 1);
});
