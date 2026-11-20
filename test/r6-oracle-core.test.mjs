import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { getAction, isGate } from '../scripts/classify-task.mjs';
import { hookTargets } from '../scripts/hook_targets.mjs';
const root=process.cwd();
const routing=JSON.parse(fs.readFileSync('skills/ulw/references/model-routing.json'));
const env={...process.env,LAZYNEON_OFFLINE:'1',LAZYNEON_NO_AUTO_UPDATE:'1',LAZYNEON_SELF_CHECK:'off',LAZYNEON_STOP_GUARD:'enforce'};
function fixture(t) { const d=fs.mkdtempSync(path.join(root,'.oracle-test-')); t.after(()=>fs.rmSync(d,{recursive:true,force:true})); return d; }
function run(script,payload,args=[]) { const r=spawnSync(process.execPath,[script,...args],{input:JSON.stringify(payload),encoding:'utf8',env}); assert.ok(r.stdout,r.stderr); return JSON.parse(r.stdout); }
test('oracle H1 doctor rejects each missing or altered event mapping',t=>{
 const d=fixture(t); for(const name of fs.readdirSync(root)) { if(name.startsWith('.')||name==='hooks.json') continue; if(name==='scripts') fs.cpSync(name,path.join(d,name),{recursive:true}); else fs.symlinkSync(path.join(root,name),path.join(d,name)); }
 const original=JSON.parse(fs.readFileSync('hooks.json'));
 for(const event of Object.keys(original.hooks)) for(const alteration of ['remove','command','matcher']) {
  const h=structuredClone(original); if(alteration==='remove') delete h.hooks[event];
  else if(alteration==='command') { const e=h.hooks[event][0]; (e.hooks?.[0]??e).command='node ./scripts/hook_targets.mjs'; }
  else h.hooks[event][0].matcher='[';
  fs.writeFileSync(path.join(d,'hooks.json'),JSON.stringify(h));
  assert.equal(run(path.join(d,'scripts/doctor.mjs'),{},['--json']).ok,false,`${event} ${alteration}`);
 }
});
for(const [name,message] of [['unrelated existing file','완료. package.json'],['self citation','완료. output.md'],['negated abstention','완료. 미확인 사항 없음.'],['bare negation','완료. 미확인 없음.'],['old commit','완료. a0164d5']]) test(`oracle H3 blocks ${name}`,t=>{
 const d=fixture(t); fs.writeFileSync(path.join(d,'package.json'),'{}'); fs.writeFileSync(path.join(d,'output.md'),'old');
 const tp=path.join(d,'transcript.jsonl'); fs.writeFileSync(tp,JSON.stringify({type:'USER_INPUT',content:'work'})+'\n'+JSON.stringify({type:'PLANNER_RESPONSE',content:message}));
 assert.equal(run('scripts/stop_claim_guard.mjs',{cwd:name==='old commit'?root:d,transcriptPath:tp,last_assistant_message:message}).decision,'continue');
});
for(const variant of ['failed','read','previous turn','unchanged','success']) test(`oracle H3 ${variant} tool provenance`,t=>{
 const d=fixture(t); const timestamp=new Date(Date.now()-2000).toISOString(); const file=path.join(d,'output.md'); fs.writeFileSync(file,'new'); if(variant==='unchanged') fs.utimesSync(file,new Date(0),new Date(0));
 const steps=[{type:'USER_INPUT',timestamp,content:'work'},{type:'PLANNER_RESPONSE',timestamp,tool_calls:[{id:'a',name:variant==='read'?'read_file':'write_file',args:{path:file,content:'new'}}]},{type:'GENERIC',tool_call_id:'a',status:variant==='failed'?'ERROR':'SUCCESS',content:`written ${file}`}];
 if(variant==='previous turn') steps.push({type:'USER_INPUT',timestamp:new Date().toISOString(),content:'next'});
 const tp=path.join(d,'transcript.jsonl'); fs.writeFileSync(tp,steps.map(JSON.stringify).join('\n'));
 assert.equal(run('scripts/stop_claim_guard.mjs',{cwd:d,transcriptPath:tp,last_assistant_message:'완료. output.md'}).decision,variant==='success'?undefined:'continue');
});
for(const variant of ['nested','files','heredoc','base64','redirect']) test(`oracle M1 limits ${variant}`,()=>{
 const big='x'.repeat(30000); const args=variant==='nested'?{data:{content:big}}:variant==='files'?{files:[{content:big}]}:{CommandLine:variant==='heredoc'?`cat > /tmp/a.txt <<'EOF'\n${big}\nEOF`:variant==='base64'?`base64 -d <<< '${big}' > /tmp/a.txt`:`printf '%s' '${big}' > /tmp/a.txt`};
 assert.equal(run('scripts/write_chunk_guard.mjs',{toolCall:{name:variant==='nested'?'kordoc_fill_form':variant==='files'?'write_files':'run_command',args}}).decision,'deny');
});
test('oracle M2 fanout gates preserve full model tier',()=>{
 for(const role of Object.keys(routing.roles).filter(r=>isGate(routing.roles,r))) assert.match(getAction(routing.roles[role].model,routing.roles,role,'subagents',routing.subagent_tiers,routing.roles[role].model),/^proceed in session/);
});
test('oracle M3 ulw executes classified gates through required adapter',()=>{
 const s=fs.readFileSync('skills/ulw/SKILL.md','utf8'); assert.match(s,/executeGate\(roles, roleName, run\)/); assert.doesNotMatch(s,/host\.runGate/); assert.match(s,/pending은 PASS가 아니다/);
});
test('oracle L1 extracts deleted patch target',()=>{
 assert.deepEqual(hookTargets([{parsed:{cwd:root,toolCall:{name:'apply_patch',args:{patch:'*** Begin Patch\n*** Delete File: gone.md\n*** End Patch'}}}}]),[path.join(root,'gone.md')]);
});

test('oracle M3 procedure runs high baseline once and refuses absent adapter',async()=>{
 const { executeGate }=await import('../scripts/classify-task.mjs');
 const classification=run('scripts/classify-task.mjs',{modelName:'unknown'},['모든 파일을 최종 리뷰해줘']);
 assert.equal(classification.gate_execution,'in_session');
 assert.ok(classification.gate_results.every(r=>r.status==='pending'&&r.evidence_required===true));
 const procedure=async (classification,routing,host,gateResults,executeGate,isGate)=>{
  for(const step of classification.steps) {
   if(!isGate(routing.roles,step.role))continue;
   const result=await executeGate(routing.roles,step.role,host.runGate);
   if(result.status!=='passed')throw new Error(result.reason??'gate refused');
   gateResults.push(result);
  }
 };
 const calls=[]; const results=[];
 await procedure(classification,routing,{runGate:async model=>{calls.push(model);return model.endsWith('-xhigh')?{status:'unavailable'}:{status:'passed',model,evidence:['review result']};}},results,executeGate,isGate);
 assert.deepEqual(calls,classification.steps.filter(step=>isGate(routing.roles,step.role)).flatMap(()=>['gemini-4-neon-high']));
 assert.equal(results[0].verdict.model,'gemini-4-neon-high');
 await assert.rejects(procedure(classification,routing,{},[],executeGate,isGate),/host_adapter_required/);
});
