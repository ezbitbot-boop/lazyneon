import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
const root=process.cwd();
const read=p=>fs.readFileSync(path.join(root,p),'utf8');
const routing=JSON.parse(read('skills/ulw/references/model-routing.json'));
const env={...process.env,LAZYNEON_OFFLINE:'1',LAZYNEON_NO_AUTO_UPDATE:'1',ANTIGRAVITY_MODEL_NAME:'',ANTIGRAVITY_MODEL:'',GEMINI_MODEL:''};
delete env.NODE_TEST_CONTEXT;
function run(script,args=[],payload={},extra={},cwd=root){return spawnSync(process.execPath,[path.join(root,'scripts',script),...args],{cwd,env:{...env,...extra},input:JSON.stringify(payload),encoding:'utf8'});}
function fixture(t){const d=fs.mkdtempSync(path.join(root,'.r9-'));t.after(()=>fs.rmSync(d,{recursive:true,force:true}));return d;}
test('R9 H2 shared host model resolution ignores GEMINI_MODEL',t=>{
 const d=fixture(t);
 for(const extra of [{GEMINI_MODEL:'gemini-4-neon-xhigh'},{ANTIGRAVITY_MODEL_NAME:' ',ANTIGRAVITY_MODEL:'gemini-4-neon-high'},{ANTIGRAVITY_MODEL_NAME:'gemini-4-neon-xhigh',ANTIGRAVITY_MODEL:'gemini-4-hydrogen-high'}]){
 const c=JSON.parse(run('classify-task.mjs',['최종 리뷰해줘'],{},extra,d).stdout);
 const s=JSON.parse(run('session_start.mjs',[],{cwd:d},extra,d).stdout);
 assert.ok(JSON.stringify(s).includes(`세션 모델: ${c.session_model}`));
 if(extra.GEMINI_MODEL) assert.equal(c.session_model,'unknown');
 }
});
test('R9 H4 unknown runtime gate remains pending without claiming PASS',()=>{
 const c=JSON.parse(run('classify-task.mjs',['구현 후 최종 리뷰해줘'],{modelName:'unknown'}).stdout);
 assert.match(c.action,/^proceed/); assert.equal(c.gate_results[0].status,'pending');
 assert.equal(c.gate_results[0].evidence_required,true);
 assert.ok(c.steps.filter(s=>s.role==='final_review').every(s=>s.action.startsWith('proceed')));
 assert.doesNotMatch(read('skills/ulw/SKILL.md'),/host\.runGate/);
 assert.match(read('README.md'),/in_session.*pending/);
});
for(const [name,command] of [
 ['python',`python3 -c "open('a','w').write('${'x'.repeat(26000)}')"`],
 ['node',`node -e "require('fs').writeFileSync('a','${'x'.repeat(26000)}')"`],
 ['ruby',`ruby -e "File.write('a','${'x'.repeat(26000)}')"`],
 ['perl',`perl -e "open F, '>a'; print F '${'x'.repeat(26000)}'"`],
]) test(`R9 M1 write limits interpreter ${name}`,()=>assert.equal(JSON.parse(run('write_chunk_guard.mjs',[],{tool_name:'run_command',tool_input:{command}}).stdout).decision,'deny'));
test('R9 H1 npm test discovers files without shell globs',t=>{
 assert.equal(JSON.parse(read('package.json')).scripts.test,'node scripts/run-tests.mjs');
 const d=fixture(t); fs.mkdirSync(path.join(d,'test'));fs.mkdirSync(path.join(d,'scripts'));
 fs.writeFileSync(path.join(d,'package.json'),read('package.json'));
 if(fs.existsSync('scripts/run-tests.mjs'))fs.copyFileSync('scripts/run-tests.mjs',path.join(d,'scripts/run-tests.mjs'));
 fs.writeFileSync(path.join(d,'test/sentinel.test.mjs'),"import test from 'node:test'; test('R9 sentinel',()=>{});\n");
 const r=spawnSync(process.execPath,['scripts/run-tests.mjs'],{cwd:d,env,encoding:'utf8'});
 assert.equal(r.status,0,r.stdout+r.stderr);assert.match(r.stdout,/R9 sentinel/);
});
for(const op of ['delete','move','bad-move','missing-write'])test(`R9 A4 relay ${op}`,t=>{
 const d=fixture(t);const extra={LAZYNEON_FEEDBACK_DIR:path.join(d,'feedback')};
 if(op.includes('move'))fs.writeFileSync(path.join(d,'new.json'),op==='bad-move'?'{':'{}');
 const p={cwd:d,conversationId:'r9',toolCall:{name:op==='missing-write'?'write_file':'apply_patch',args:op==='missing-write'?{path:'gone.md',content:'x'}:{patch:op==='delete'?'*** Begin Patch\n*** Delete File: gone.md\n*** End Patch':'*** Begin Patch\n*** Update File: old.json\n*** Move to: new.json\n@@\n-{}\n+{}\n*** End Patch'}}};
 const hooks=JSON.parse(read('hooks.json')).hooks;
 for(const entry of hooks.PostToolUse){if(!new RegExp(entry.matcher).test(p.toolCall.name))continue;for(const h of entry.hooks){const [node,...args]=h.command.split(/\s+/);assert.equal(node,'node');const r=spawnSync(process.execPath,args,{cwd:root,input:JSON.stringify(p),encoding:'utf8',env:{...env,...extra}});assert.equal(r.status,0,r.stderr);}}
 const r=JSON.parse(run('post_tool_feedback.mjs',['inject'],p,extra).stdout);
 if(['delete','move'].includes(op))assert.deepEqual(r,{});else assert.match(JSON.stringify(r),/guard_failed/);
});
test('R9 M1 plugin path works from unrelated cwd',t=>{
 const d=fixture(t);const r=run('session_start.mjs',[],{cwd:d},{},d);
 assert.ok(JSON.stringify(JSON.parse(r.stdout)).includes(`플러그인 경로: ${root}`));
 for(const p of ['skills/ulw/SKILL.md','rules/AGENTS.md','skills/programming/SKILL.md','skills/image-prompt/SKILL.md','skills/image-prompt/references/jsonl-and-examples.md'])assert.doesNotMatch(read(p),/node scripts\//);
 const c=run('classify-task.mjs',['implement typo'],{},{},d);assert.equal(c.status,0,c.stderr);
});
test('R9 M2 routing table matches every configured task',()=>{
 const rows=read('docs/model-routing.md').split('\n').filter(l=>/^\| `\w+` \| `\w+` \| `gemini/.test(l));
 assert.equal(rows.length,Object.keys(routing.task_kinds).length);
 for(const [kind,def] of Object.entries(routing.task_kinds)){const role=routing.roles[def.role];assert.ok(rows.includes(`| \`${kind}\` | \`${def.role}\` | \`${role.model}\` | \`${role.fallback??'-'}\` |`),kind);}
});
test('R9 M3 notice is not gate permission',()=>assert.match(read('skills/ulw/SKILL.md'),/notice는 진행 허가가 아니다/));
test('R9 M4 doctor command targets core diagnostics',()=>{for(const p of ['commands/doctor.md','prompts/doctor.md'])assert.match(read(p),/scripts\/doctor\.mjs/);});
test('R9 M5 documented shape check throws on incorrect output',()=>{
 const doc=read('docs/model-routing.md');const block=doc.match(/# 5\. Classifier shape check[^\n]*\n([\s\S]*?)# Expected:/)[1];
 assert.doesNotMatch(block,/console\.assert/);
 const flattened=block.replace(/\\\n/g,'');
 const match=flattened.match(/^node (\S+) "([^"]+)" \| node -e\s+"([\s\S]+)"\s*$/);assert.ok(match,flattened);
 const source=run('classify-task.mjs',[match[2]]);assert.equal(source.status,0,source.stderr);
 const check=code=>spawnSync(process.execPath,['-e',code],{cwd:root,env,input:source.stdout,encoding:'utf8'});
 const r=check(match[3]);assert.equal(r.status,0,r.stderr);assert.equal(r.stdout.trim(),'shape ok');
 assert.notEqual(check(match[3].replace(/unverified-neon/g,'wrong-path')).status,0);
});
test('R9 L1 guard modes and environment documented',()=>{
 const doc=read('README.md');for(const file of fs.readdirSync('scripts').filter(f=>f.endsWith('.mjs')))for(const key of read('scripts/'+file).match(/LAZYNEON_[A-Z_]+/g)??[])assert.ok(doc.includes(key),key);
 assert.match(read('scripts/stop_claim_guard.mjs'),/LAZYNEON_SELF_CHECK.*기본.*on/);
});
test('R9 L2 selfcheck is a statistics CLI',()=>assert.match(read('README.md'),/selfcheck_stats\.mjs.*통계 CLI/));
test('R9 L3 diagnostics do not claim worktree isolation',t=>{
 const d=fixture(t);fs.writeFileSync(path.join(d,'a.json'),'{}');
 for(const cmd of ['check','snapshot','verify']){const r=run('lsp_diagnostics.mjs',[cmd,'--root',d,'--files','a.json']);assert.equal(JSON.parse(r.stdout).worktree_isolated,false);}
});
test('R9 L4 current STT differs from historical measurements',()=>assert.ok(read('docs/model-routing.md').includes(`현재 STT 모델: \`${routing.roles.tool_first.stt_model}\``)));
test('R9 L5 vision does not route to Carbon',()=>assert.doesNotMatch(read('skills/visual-qa/SKILL.md'),/Carbon/));
test('R9 L6 tail read contract matches guards',()=>assert.match(read('rules/AGENTS.md'),/readTailLines\(tp, 50, 32\*1024\)/));
