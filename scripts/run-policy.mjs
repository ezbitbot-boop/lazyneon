import fs from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
export const promotionReasons=['failed_verification','interface_change','conflicting_evidence'];
export function promoted(promotion,{cwd=process.cwd(),gate,receipts=[]}={}) {
 if(!promotionReasons.includes(promotion?.reason)||!gate||promotion.gate!==gate||!Array.isArray(promotion.evidence)) return false;
 return promotion.evidence.some(e=>{
  if(!e||typeof e!=='object') return false;
  if(typeof e.path==='string') {try {return fs.statSync(path.resolve(cwd,e.path)).isFile();} catch {return false;}}
  return typeof e.receipt_id==='string'&&receipts.some(r=>r.id===e.receipt_id&&typeof r.log==='string'&&fs.existsSync(path.resolve(cwd,r.log)));
 });
}
export function recordReplan(run,replan,cap) {
 if(typeof replan?.reason!=='string'||!replan.reason.trim()||!Array.isArray(replan.evidence)||!replan.evidence.length) throw Error('replan reason and evidence required');
 if(!Number.isInteger(cap)||cap<0||(run.replans??[]).length>=cap) throw Error('replan cap reached');
 return {...run,replans:[...(run.replans??[]),{...replan,at:new Date().toISOString()}]};
}
export function quotaDecision(quota={},policy={}) {
 if(['model_rate_limited','account_quota_exceeded'].includes(quota.error)) return {blocked:true,reason:quota.error,measurement:'observed error'};
 const observed=typeof quota.observed_at==='string'?Date.parse(quota.observed_at):quota.observed_at;
 const fresh=Number.isFinite(observed)&&Date.now()-observed>=0&&Date.now()-observed<300000;
 if(!fresh) return {blocked:false,reason:'quota_unknown',measurement:'[미측정]'};
 for(const kind of ['account','model']) {
  const remaining=quota[kind]?.remaining_percent,threshold=policy[`${kind}_min_percent`];
  if(Number.isFinite(remaining)&&remaining>=0&&remaining<=100&&(remaining===0||(Number.isFinite(threshold)&&remaining<threshold)))
   return {blocked:true,reason:`${kind}_quota_low`,measurement:'observed'};
 }
 return {blocked:false,reason:'quota_available',measurement:'observed'};
}
export function guardRun(cwd,run,quota,policy) {
 const decision=quotaDecision(quota,policy);
 if(run.usage?.class!=='heavy'&&!decision.blocked) return decision;
 const dir=path.join(cwd,'.lazyneon','checkpoints'); fs.mkdirSync(dir,{recursive:true});
 const checkpoint=path.join(dir,`${Date.now()}-${randomUUID()}.json`);
 fs.writeFileSync(checkpoint,JSON.stringify({version:1,run,quota,decision},null,2),{flag:'wx',mode:0o600});
 return {...decision,checkpoint};
}
export function resumeRun(file,quota,policy) {
 const saved=JSON.parse(fs.readFileSync(file,'utf8'));
 const decision=quotaDecision(quota,policy);
 // Unknown quota cannot demonstrate recovery from an observed limit.
 if(saved.decision.blocked) {
  const kind=saved.decision.reason.startsWith('model')?'model':'account';
  const remaining=quota?.[kind]?.remaining_percent;
  if(decision.measurement==='[미측정]'||!Number.isFinite(remaining)||remaining<=0||remaining>100)
   return {...decision,blocked:true,reason:'recovery_unverified',run:saved.run};
 }
 return {...decision,run:saved.run};
}
