import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {spawn, spawnSync} from 'node:child_process';
import {completionEvidence} from '../scripts/stop_claim_guard.mjs';
const root=process.cwd();
const env={...process.env,LAZYNEON_OFFLINE:'1',LAZYNEON_STOP_GUARD:'enforce',LAZYNEON_SELF_CHECK:'on'};
function fixture(t){const d=fs.mkdtempSync(path.join(root,'.r12-'));t.after(()=>fs.rmSync(d,{recursive:true,force:true}));return d;}
function run(script,payload){const r=spawnSync(process.execPath,[`scripts/${script}.mjs`],{env,input:JSON.stringify(payload),encoding:'utf8'});return JSON.parse(r.stdout);}
for(const mode of ['args idle','args JSON open','no args idle','prompt open']) test(`R12 classifier exits with ${mode} stdin`,async()=>{
 // Use a real blocking descriptor: Node spawn sockets otherwise return EAGAIN on macOS.
 const c=spawn(process.execPath,['--import','data:text/javascript,process.stdin._handle?.setBlocking(true)','scripts/classify-task.mjs',...(mode.startsWith('args')?['review']:[])],{env,stdio:['pipe','pipe','pipe']});
 let out='';c.stdout.on('data',b=>out+=b);c.stdin.on('error',()=>{});
 if(mode==='args JSON open')c.stdin.write(JSON.stringify({modelName:'gemini-4-neon-high'}));
 if(mode==='prompt open')c.stdin.write('review');
 const result=await new Promise(resolve=>{const timer=setTimeout(()=>{c.kill();resolve('timeout');},2500);c.on('close',code=>{clearTimeout(timer);resolve(code);});});
 assert.equal(result,mode==='no args idle'?1:0);
 if(mode==='args JSON open')assert.equal(JSON.parse(out).session_model,'gemini-4-neon-high');
});
for(const message of ['테스트 통과.','323개 테스트 통과.','전부 반영했다.','작업 끝났다.','문제없음','이상 없음','오류 없음','빠짐없이 확인'])test(`R12 Korean claim requires evidence: ${message}`,t=>{
 assert.equal(run('stop_claim_guard',{cwd:fixture(t),last_assistant_message:message}).decision,'continue');
});
function transcript(name,args,variant='success'){
 const timestamp=new Date(Date.now()-1000).toISOString();
 const steps=[{type:'USER_INPUT',timestamp},{type:'PLANNER_RESPONSE',timestamp:variant==='stale'?new Date(0).toISOString():timestamp,tool_calls:[{id:'r',name,args}]},{type:'GENERIC',tool_call_id:variant==='unlinked'?'other':'r',status:variant==='failed'?'ERROR':'SUCCESS',content:'source text 42'}];
 if(variant==='previous')steps.push({type:'USER_INPUT',timestamp});
 return steps.map(JSON.stringify).join('\n');
}
test('R12 read evidence accepts current successful file and command citations only',t=>{
 const d=fixture(t);
 for(const file of ['contract.pdf','appraisal.md','contract.docx','source.hwpx','data.xlsx','mail.eml','disk.e01']){
  fs.writeFileSync(path.join(d,file),'source text 42');
  fs.utimesSync(path.join(d,file),new Date(0),new Date(0));
  const msg=`검토 완료. 근거: ${file}`;
  assert.equal(completionEvidence(msg,transcript('read_file',{path:file}),d),true,file);
  for(const v of ['stale','unlinked','failed','previous'])assert.equal(completionEvidence(msg,transcript('read_file',{path:file},v),d),false,v);
  assert.equal(completionEvidence(`작성 완료. ${file}`,transcript('read_file',{path:file}),d),false);
  assert.equal(completionEvidence('검토 완료. unread.pdf',transcript('read_file',{path:file}),d),false);
 }
 const tp=path.join(d,'transcript.jsonl');
 fs.writeFileSync(tp,transcript('read_file',{path:'contract.pdf'}));
 assert.equal(run('stop_claim_guard',{cwd:d,transcriptPath:tp,last_assistant_message:'검토 완료. 근거: contract.pdf'}).decision,undefined);
 const cmd='rg -n evidence appraisal.md';
 assert.equal(completionEvidence(`검토 완료. 실행: \`${cmd}\``,transcript('exec_command',{cmd}),d),true);
 assert.equal(completionEvidence('검토 완료. `cat unread.pdf`',transcript('exec_command',{cmd}),d),false);
 assert.equal(completionEvidence('검토 완료. `echo fabricated`',transcript('exec_command',{cmd:'echo fabricated'}),d),false);
});
for(const command of ['dd of=/tmp/a.txt',"sed -i 's/hi/bye/' /tmp/a.txt",'install -m 644 /dev/stdin /tmp/a.txt','rsync -a /dev/stdin /tmp/a.txt'])test(`R12 write limits cover ${command}`,()=>{
 for(const body of ['x'.repeat(30000),'x\n'.repeat(251)])assert.equal(run('write_chunk_guard',{toolCall:{name:'run_command',args:{CommandLine:command,stdin:body}}}).decision,'deny');
 assert.equal(run('write_chunk_guard',{toolCall:{name:'run_command',args:{CommandLine:command,stdin:'small'}}}).decision,undefined);
 if(command.startsWith('sed'))assert.equal(run('write_chunk_guard',{toolCall:{name:'run_command',args:{CommandLine:`sed -i 's/hi/${'x'.repeat(30000)}/' /tmp/a.txt`}}}).decision,'deny');
});
