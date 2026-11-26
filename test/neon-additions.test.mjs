import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {completionEvidence} from '../scripts/stop_claim_guard.mjs';
const env={...process.env,LAZYNEON_OFFLINE:'1',LAZYNEON_NO_AUTO_UPDATE:'1'};
// SessionStart records the session model under <workspace>/.lazyneon; keep it out of the plugin root,
// where it would leak into classify-task runs of other test files.
const workspace=fs.mkdtempSync(path.join(os.tmpdir(),'lazyneon-neon-'));
process.on('exit',()=>fs.rmSync(workspace,{recursive:true,force:true}));
function run(script,prompt,payload={}) {
 const input=script==='session_start'&&!payload.cwd?{...payload,cwd:workspace}:payload;
 const r=spawnSync(process.execPath,[`scripts/${script}.mjs`,...(prompt?[prompt]:[])],{env,input:JSON.stringify(input),encoding:'utf8'});
 assert.equal(r.status,0,r.stderr); return JSON.parse(r.stdout);
}
const classify=(prompt,payload={})=>run('classify-task',prompt,{modelName:'gemini-4-neon-high',...payload});
test('N1 recommended economy levels and both mismatch notices',()=>{
 const routing=JSON.parse(fs.readFileSync('skills/ulw/references/model-routing.json'));
 for(const role of Object.values(routing.roles)) assert.match(role.recommended_level,/^(medium|high|xhigh)$/);
 const r=classify('count rows'); assert.equal(r.recommended_level,'medium'); assert.match(r.session_notice,/비용/);
 assert.equal(classify('implement feature').recommended_level,'high');
 const gate=classify('final review',{promotion:{reason:'failed_verification',gate:'final_review',evidence:[{path:'package.json'}]}}); assert.equal(gate.recommended_level,'xhigh'); assert.match(gate.session_notice,/xhigh/);
});
test('N2 Hydrogen claims schedule Neon verification before adoption',()=>{
 for(const prompt of ['implement 3 files','fix and test','plan implement 3 files final review']) {
  const r=classify(prompt); const i=r.steps.findIndex(s=>s.role==='worker_verification');
  assert.ok(i>0); assert.match(r.steps[i].model,/neon-high$/); assert.equal(r.steps[i].evidence_required,true);
  assert.match(r.steps[i].action,/each worker claim/);
  assert.equal(r.gate_results.find(g=>g.role==='worker_verification').status,'pending');
 }
 const timestamp=new Date().toISOString();
 const transcript=name=>[{type:'USER_INPUT',timestamp},{type:'PLANNER_RESPONSE',timestamp,tool_calls:[{id:'w',name,args:{cmd:'npm test'}}]},{type:'GENERIC',tool_call_id:'w',status:'SUCCESS',content:'100 passed'}].map(JSON.stringify).join('\n');
 assert.equal(completionEvidence('100 passed',transcript('invoke_subagent'),process.cwd()),false);
 assert.equal(completionEvidence('100 passed',transcript('exec_command'),process.cwd()),true);
});
test('N3 SessionStart static prefix identical across different dynamic state',()=>{
 const context=p=>run('session_start',null,p).injectSteps[0].systemMessage.systemMessage;
 const a=context({modelName:'gemini-4-neon-high',task:'count rows'}),b=context({modelName:'gemini-4-neon-xhigh',task:'implement 3 files'});
 const prefix=s=>s.split('## LazyNeon 런타임')[0];
 assert.equal(Buffer.byteLength(prefix(a)),0);
 assert.equal(prefix(a),prefix(b)); assert.notEqual(a,b);
 assert.ok(!prefix(a).includes('# LazyNeon')&&!prefix(a).includes('# ULW'));
});
test('N3 Office inputs use Neon direct with conditional conversion fallback',()=>{
 for(const ext of ['docx','xlsx','pptx','odt','ods','odp']) {
  const r=classify(`read report.${ext}`); assert.equal(r.document_input.model,'gemini-4-neon-high');
  assert.equal(r.steps[0].role,'document_input'); assert.match(r.steps[0].action,/directly/);
  assert.equal(r.document_input.mode,'direct_if_supported'); assert.equal(r.document_input.fallback,'conversion');
 }
 const skill=fs.readFileSync('skills/ulw/SKILL.md','utf8');
 assert.match(skill,/previous_interaction_id/); assert.match(skill,/long-decode/);
});
test('N4 long context chunks first and Carbon is last resort with dated cost note',()=>{
 const r=classify('read 2000000 tokens'); assert.equal(r.model,'gemini-4-neon-high');
 // https://antigravity.google/docs/models: Neon in Antigravity is up to 512K; 1M is the direct API limit.
 assert.equal(r.context_policy.unified_limit_tokens,524288);
 assert.equal(r.context_policy.api_limit_tokens,1048576);
 assert.match(r.context_policy.limit_source,/antigravity\.google\/docs\/models/);
 assert.equal(r.context_policy.strategy,'chunk_with_output_reserve');
 assert.match(r.context_policy.fallback_condition,/last.resort/);
 assert.match(r.context_policy.cost_note,/2026-12-01.*2/);
});
test('N5 size times level usage estimates warn without blocking',()=>{
 const light=classify('count rows'),medium=classify('implement feature'),heavy=classify('implement 3 files');
 assert.equal(light.usage.class,'light'); assert.equal(medium.usage.class,'medium'); assert.equal(heavy.usage.class,'heavy');
 assert.match(heavy.usage.warning,/heavy/); assert.equal(heavy.usage.blocked,false); assert.match(heavy.usage.note,/미측정/);
 const ctx=run('session_start',null,{task:'implement 3 files',modelName:'gemini-4-neon-high'}).injectSteps[0].systemMessage.systemMessage;
 assert.match(ctx,/사용량: heavy/); assert.match(ctx,/차단하지/);
});
