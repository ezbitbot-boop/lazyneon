import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {buildCodeGraph} from '../scripts/codegraph.mjs';
import {runDiagnosticsCheck,runSnapshot,runVerify,runRenamePreview} from '../scripts/lsp_diagnostics.mjs';
import {makeHandoff,verifyHandoff} from '../scripts/handoff-contract.mjs';
import {acceptWorker} from '../scripts/worker-contract.mjs';
import {auditReceipts,pollReceipts} from '../scripts/upstream_radar.mjs';
import {initManifest,buildBriefing} from '../skills/ulw-research/scripts/outcome.mjs';
import {writeJsonAtomic,emit} from '../skills/ulw-research/scripts/cli-support.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const version=JSON.parse(fs.readFileSync(path.join(root,'plugin.json'))).version;
const commit=spawnSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).stdout.trim();
function check(p){assert.equal(p?.version,version);assert.equal(p.commit,commit);assert.equal(typeof p.dirty,'boolean');}
test('provenance helper reports plugin version commit dirty and unknown archive',async t=>{
 const {pluginProvenance}=await import('../scripts/provenance.mjs');check(pluginProvenance());
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'la-provenance-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 fs.writeFileSync(path.join(dir,'plugin.json'),'{"version":"archive"}');
 assert.deepEqual(pluginProvenance(dir),{version:'archive',commit:null,dirty:null});
});
test('provenance covers core evidence reports and research artifacts',async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'la-reports-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 fs.writeFileSync(path.join(dir,'report'),'evidence');
 const h=makeHandoff({scope:['test'],unresolved:[],artifacts:['report']},dir);
 const manifest=initManifest({sessionDir:'20261120-120000',promised:[],lane:null});
 const results={graph:buildCodeGraph(dir),diagnostics:runDiagnosticsCheck({root:dir}),snapshot:runSnapshot({root:dir}),verify:runVerify({root:dir}),rename:runRenamePreview({root:dir,from:'old',to:'new'}),handoff:h,handoffVerify:verifyHandoff(h,dir),worker:acceptWorker({scope:['test'],unresolved:[],receipts:[],defects:[],artifact:'report',status:'complete'},{cwd:dir}),audit:auditReceipts(),auditError:auditReceipts(path.join(dir,'missing')),poll:pollReceipts(undefined,{remote:false}),manifest};
 for(const [name,result] of Object.entries(results))await t.test(name,()=>check(result.plugin));
 await t.test('briefing',()=>assert.ok(buildBriefing(manifest,'',new Date()).includes(commit)));
 await t.test('report artifact writer',()=>{const file=path.join(dir,'evidence.json');writeJsonAtomic(file,{evidence:'abc'});check(JSON.parse(fs.readFileSync(file)).plugin);});
 await t.test('report CLI output',()=>{let text='';emit({json:{evidence:'abc'}},{stdout:{write:s=>text+=s},stderr:{write(){}}});check(JSON.parse(text).plugin);});
});
test('doctor JSON and text contain plugin provenance offline',()=>{
 for(const args of [['--json'],[]]){
  const r=spawnSync(process.execPath,['scripts/doctor.mjs',...args],{cwd:root,encoding:'utf8',env:{...process.env,LAZYNEON_OFFLINE:'1'}});
  if(args.length)check(JSON.parse(r.stdout).plugin);else assert.ok(r.stdout.includes(commit));
 }
});

test('statistics artifact and stop evidence log identify producer',async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'la-log-provenance-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const run=(name,args=[],payload={})=>spawnSync(process.execPath,[path.join(root,'scripts',name),...args],{cwd:dir,encoding:'utf8',input:JSON.stringify(payload),env:{...process.env,LAZYNEON_OFFLINE:'1',LAZYNEON_SELF_CHECK:'off',LAZYNEON_STOP_GUARD:'observe'}});
 await t.test('statistics',()=>{const out=path.join(dir,'stats.json');const r=run('selfcheck_stats.mjs',['--brain',dir,'--out',out]);assert.equal(r.status,0,r.stderr);check(JSON.parse(fs.readFileSync(out)).plugin);assert.ok(r.stdout.includes(commit));});
 await t.test('stop log',()=>{const r=run('stop_claim_guard.mjs',[],{cwd:dir,last_assistant_message:'구현 완료. 모든 테스트 통과했습니다.'});assert.equal(r.status,0,r.stderr);const entries=fs.readFileSync(path.join(dir,'.lazyneon/stop-guard.jsonl'),'utf8').trim().split('\n').map(JSON.parse);for(const e of entries)check(e.plugin);});
});

test('post-tool feedback evidence identifies producer',t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'la-feedback-provenance-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const r=spawnSync(process.execPath,[path.join(root,'scripts/post_tool_feedback.mjs'),'batch',path.join(root,'scripts/markdown_structure_guard.mjs')],{cwd:dir,encoding:'utf8',input:JSON.stringify({conversationId:'provenance',tool_name:'write_to_file',tool_input:{TargetFile:path.join(dir,'bad.md'),CodeContent:'# Report\n<thinking>secret</thinking>'}}),env:{...process.env,LAZYNEON_OFFLINE:'1',LAZYNEON_FEEDBACK_DIR:dir}});
 assert.equal(r.status,0,r.stderr);const entries=fs.readFileSync(path.join(dir,'provenance.jsonl'),'utf8').trim().split('\n').map(JSON.parse);for(const e of entries)check(e.plugin);
});
