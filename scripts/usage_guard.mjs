import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {guardRun,recordReplan,resumeRun,quotaDecision} from './run-policy.mjs';
import {classifyTask} from './classify-task.mjs';
import {resolveWorkspace} from './workspace-path.mjs';
import {isMainModule} from './is-main.mjs';
import {withinPath} from './same-path.mjs';
import {fileURLToPath} from 'node:url';
import {readStdin} from './read-stdin.mjs';
// State belongs to an explicit workspace/task, never to the plugin launcher cwd.
export function usageGuard(payload={}) {
 try {return observeUsage(payload);} catch(error) {return {blocked:false,warning:`[미확인] usage state: ${error.message}`};}
}
function observeUsage(payload) {
 const cwd=resolveWorkspace(payload,null);
 if(!cwd||withinPath(cwd,fileURLToPath(new URL('..',import.meta.url)))) return {blocked:false,warning:'[미확인] explicit non-plugin workspace required; state not saved'};
 const dir=path.join(cwd,'.lazyneon'),runs=path.join(dir,'runs');
 const task=typeof payload.task==='string'?payload.task:payload.run?.id??'host-invocation';
 const id=createHash('sha256').update(JSON.stringify([payload.conversationId??'',task])).digest('hex');
 const stateFile=path.join(runs,id+'.json');
 const read=file=>JSON.parse(fs.readFileSync(file,'utf8'));
 const routing=JSON.parse(fs.readFileSync(new URL('../skills/ulw/references/model-routing.json',import.meta.url),'utf8'));
 let run=fs.existsSync(stateFile)?read(stateFile):{id,task,scope:[task],unresolved:[],next:'execute',replans:[],usage:classifyTask(task,payload).usage};
 const ledgerFile=path.join(dir,'replans.jsonl');
 const ledger=fs.existsSync(ledgerFile)?fs.readFileSync(ledgerFile,'utf8').split('\n').filter(Boolean).map(JSON.parse).filter(r=>r.id===id).map(r=>r.replan):[];
 if(ledger.length>run.replans.length) run.replans=ledger;
 let quota=payload.quota;
 if(!quota&&fs.existsSync(path.join(dir,'quota.json'))) quota=read(path.join(dir,'quota.json'));
 quota??={};
 if(payload.resume_checkpoint) {
  const resumed=resumeRun(payload.resume_checkpoint,quota,routing.quota_guard);
  if(resumed.run.id!==id) throw Error('checkpoint task mismatch');
  run={...resumed.run,replans:run.replans.length>=resumed.run.replans.length?run.replans:resumed.run.replans,
   checkpoint:run.checkpoint,quota_blocked:run.quota_blocked??resumed.run.quota_blocked};
 }
 fs.mkdirSync(runs,{recursive:true});
 let cap_reached=false;
 if(payload.replan) {
  if(run.replans.length>=routing.reasoning_policy.max_replans) cap_reached=true;
  else {
   run=recordReplan(run,payload.replan,routing.reasoning_policy.max_replans);
   fs.appendFileSync(ledgerFile,JSON.stringify({id,replan:run.replans.at(-1)})+'\n',{mode:0o600});
  }
 }
 let decision=quotaDecision(quota,routing.quota_guard);
 if(run.quota_blocked) {
  const kind=run.quota_blocked.reason.startsWith('model')?'model':'account';
  if(decision.measurement==='[미측정]'||!(quota[kind]?.remaining_percent>0)) decision=run.quota_blocked;
 }
 const transition=decision.blocked&&!run.quota_blocked;
 run.quota_blocked=decision.blocked?decision:null;
 if((run.usage?.class==='heavy'&&!run.checkpoint)||transition) {
  const saved=guardRun(cwd,run,quota,routing.quota_guard);run.checkpoint=saved.checkpoint;
 }
 fs.writeFileSync(stateFile,JSON.stringify(run,null,2),{mode:0o600});
 return {...decision,checkpoint:run.checkpoint,cap_reached,replans:run.replans.length,
  warning:cap_reached?'warning: replan cap reached':decision.blocked?`warning: ${decision.reason}`:payload.replan?'warning: replan recorded':run.usage?.warning};
}
if(isMainModule(import.meta.url)) {
 let payload={};
 try {payload=JSON.parse((await readStdin(1500))||'{}');} catch {}
 // Exit once flushed: a host that keeps stdin open would otherwise hold the hook until its timeout.
 const done=warning=>{const answer=()=>process.stdout.write('{}\n',()=>process.exit(0));if(warning) process.stderr.write(`${warning}\n`,answer);else answer();};
 try {
  done(usageGuard(payload).warning);
 } catch(e) {done(`[미확인] ${e.message}`);}
}
