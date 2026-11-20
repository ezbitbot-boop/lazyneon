import {pluginProvenance} from './provenance.mjs';
import fs from 'node:fs';
import path from 'node:path';
import {artifact} from './handoff-contract.mjs';
import {isMainModule} from './is-main.mjs';
// Parent supplies independently observed execution receipts. Worker prose cannot certify itself.
export function acceptWorker(report,{cwd=process.cwd(),receipts=[]}={}) {
 for (const key of ['scope','unresolved','receipts','defects']) if (!Array.isArray(report[key])) throw Error(`${key} required`);
 if (!['complete','partial','unknown','failed'].includes(report.status)) throw Error('status required');
 if (!report.scope.length||!report.artifact) throw Error('scope and full report artifact required');
 const full=artifact(report.artifact,cwd);
 const validReceipt=r=>{
  if(!r||typeof r.id!=='string'||!r.id||typeof r.command!=='string'||!r.command.trim()||!Number.isInteger(r.exit_code)||typeof r.output!=='string'||typeof r.log!=='string') return false;
  try {return fs.readFileSync(path.resolve(cwd,r.log),'utf8')===r.output;} catch {return false;}
 };
 const confirmed=report.receipts.filter(local=>receipts.some(observed=>validReceipt(observed)&&local.id===observed.id&&local.command===observed.command&&local.exit_code===observed.exit_code&&local.output===observed.output));
 const unconfirmed=report.receipts.filter(r=>!confirmed.includes(r)).map(r=>r?.id??null);
 const failed=confirmed.some(r=>r.exit_code!==0||/\b[1-9][\d,]*\s+(?:failed|failures)\b|\bfail(?:ed|ures)?\s*[:=]?\s*[1-9]\d*/i.test(r.output));
 const adopted=[],rejected=[];
 for (const d of report.defects) {
  const local=report.receipts.find(r=>r.id===d.receipt_id);
  const observed=receipts.find(r=>r.id===d.receipt_id);
  let reproduced=false;
  if (local&&observed&&typeof d.input==='string'&&typeof d.expected==='string'&&typeof d.actual==='string'&&d.expected!==d.actual) {
   reproduced=typeof observed.command==='string'&&Number.isInteger(observed.exit_code)&&typeof observed.output==='string'
    &&observed.output.includes(d.actual)&&local.command===observed.command&&local.exit_code===observed.exit_code&&local.output===observed.output;
   try {reproduced&&=fs.readFileSync(path.resolve(cwd,observed.log),'utf8')===observed.output;} catch {reproduced=false;}
  }
  (reproduced?adopted:rejected).push(d.id);
 }
 return {plugin:pluginProvenance(),status:report.status,scope:report.scope,evidence:receipts,unresolved:report.unresolved,artifact:full,adopted,rejected,unconfirmed,
  acceptance:rejected.length||unconfirmed.length||!confirmed.length?'needs_reproduction':failed||report.unresolved.length||report.status!=='complete'?'partial':'reviewed'};
}
if(isMainModule(import.meta.url)) {
 try {
  const [report,receiptFile]=process.argv.slice(2);
  const result=acceptWorker(JSON.parse(fs.readFileSync(report,'utf8')),{receipts:JSON.parse(fs.readFileSync(receiptFile,'utf8'))});
  console.log(JSON.stringify(result,null,2));
  if(result.acceptance!=='reviewed') process.exitCode=1;
 } catch(e) {console.error(e.message);process.exitCode=1;}
}
