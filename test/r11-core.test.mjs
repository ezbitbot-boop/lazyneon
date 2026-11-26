import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {getAction} from '../scripts/classify-task.mjs';
const root=process.cwd();
const routing=JSON.parse(fs.readFileSync('skills/ulw/references/model-routing.json'));
const env={...process.env,LAZYNEON_OFFLINE:'1',LAZYNEON_NO_AUTO_UPDATE:'1',ANTIGRAVITY_MODEL_NAME:'',ANTIGRAVITY_MODEL:''};
const prompts=['이 감정보고서 검토해줘','증거 폴더 해시 목록 만들어줘','이 사진 위변조 여부 판단해줘','개인정보 마스킹해줘','이 코드 리뷰해줘','작업 계획 세워줘','대화 파싱해서 타임라인 만들어줘','소장 초안 작성해줘','녹취록 전사해줘','이 판결문 요약해줘','증거 매니페스트 검증해줘','보고서 해시가 맞는지 검증해줘','계약서 PDF에 갑 제1호증 표찰 붙여줘','이 폴더 전체 선조사해줘','README 오타 수정해줘'];
function fixture(t){const d=fs.mkdtempSync(path.join(root,'.r11-'));t.after(()=>fs.rmSync(d,{recursive:true,force:true}));return d;}
function run(d,script,args=[],payload={},extra={}){const r=spawnSync(process.execPath,[path.join(root,'scripts',script),...args],{cwd:d,env:{...env,...extra},input:JSON.stringify(payload),encoding:'utf8'});assert.equal(r.status,0,r.stderr);return JSON.parse(r.stdout);}
test('R11 SessionStart payload reaches classifier; all 15 requests proceed at xhigh high unknown',t=>{
 const d=fixture(t);
 for(const model of ['gemini-4-neon-xhigh','gemini-4-neon-high','unknown']){
  run(d,'session_start.mjs',[],{workspacePaths:[d],conversationId:'r11',modelName:model});
  for(const p of prompts){const c=run(d,'classify-task.mjs',[p]);assert.equal(c.session_model,model);assert.doesNotMatch(c.action,/refuse|delegate/);assert.ok(c.gate_results.every(g=>g.status==='pending'&&g.evidence_required));if(c.gate_results.length&&model.endsWith('-high'))assert.equal(c.session_notice,null);if(model==='unknown')assert.match(c.session_notice,/미확인/);}
 }
});
test('R11 mechanical checks are script first but authenticity and PII keep gates',t=>{
 const d=fixture(t);
 for(const p of ['증거 매니페스트 검증해줘','보고서 해시가 맞는지 검증해줘']){const c=run(d,'classify-task.mjs',[p]);assert.equal(c.kind,'count_extract');assert.equal(c.gate_results.length,0);assert.equal(c.steps[0].role,'script_first');}
 for(const p of ['해시 검증 후 위변조 여부 판단해줘','매니페스트 검증 후 개인정보 마스킹해줘'])assert.ok(run(d,'classify-task.mjs',[p]).gate_results.length>0);
});
test('R11 non-Neon sessions refuse Neon gates and name the model to switch to',t=>{
 const d=fixture(t);
 const c=run(d,'classify-task.mjs',['최종 리뷰해줘'],{modelName:'gemini-4-carbon-high'});
 assert.match(c.action,/^refuse: needs gemini-4-neon-high; switch the model picker to Gemini 4 Neon/);assert.equal(c.gate_execution,'neon_session_required');assert.equal(c.gate_results[0].status,'refused');assert.equal(c.gate_results[0].reason,'neon_session_required');
 for(const role of ['default','plan','verdict_review'])for(const model of ['gemini-4-carbon-high','gemini-4-hydrogen-high','other-model']){
 const required=routing.roles[role].model;assert.match(getAction(required,routing.roles,role,'single',{},model),/^refuse:/);assert.match(getAction(required,routing.roles,role,'single',{pro:'gemini-4-neon'},model),/^delegate:/);
 }
});
test('R11 session state isolation, host precedence, missing and corrupt state remain unknown',t=>{
 const d=fixture(t),other=fixture(t);
 run(d,'session_start.mjs',[],{cwd:d,conversationId:'A',modelName:'gemini-4-neon-xhigh'});
 assert.equal(run(d,'classify-task.mjs',['review'],{conversationId:'B'}).session_model,'unknown');
 assert.equal(run(other,'classify-task.mjs',['review']).session_model,'unknown');
 assert.equal(run(d,'classify-task.mjs',['review'],{modelName:'gemini-4-neon-high'}).session_model,'gemini-4-neon-high');
 const state=path.join(d,'.lazyneon/session-model.json');
 fs.writeFileSync(state,JSON.stringify({model:'gemini-4-neon-xhigh',recordedAt:Date.now()-25*60*60*1000}));
 assert.equal(run(d,'classify-task.mjs',['review']).session_model,'unknown');
 fs.writeFileSync(state,'{');
 assert.equal(run(d,'classify-task.mjs',['review']).session_model,'unknown');
});
