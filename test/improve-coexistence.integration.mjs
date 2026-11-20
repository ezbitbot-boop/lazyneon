// Explicit integration suite; requires both independent plugin checkouts.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
const core=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const companion=process.env.LAZYNEON_COMPANION_TEST_ROOT??path.join(core,'..','lazyneon-workspace');
const manifests=[core,companion].map(root=>({root,hooks:JSON.parse(fs.readFileSync(path.join(root,'hooks.json'))).hooks}));
function run(plugin,event,payload,env) {
 return (plugin.hooks[event]??[]).flatMap(entry=>{
  if(entry.matcher&&!new RegExp(entry.matcher).test(payload.toolCall?.name??'')) return [];
  return (entry.hooks??[entry]).map(hook=>{
   const [command,...args]=hook.command.split(/\s+/);assert.equal(command,'node');
   // Match the r6 hook runner: resolve registered scripts, no shell or cross-repo imports.
   const resolved=args.map(a=>a.startsWith('./')?path.resolve(plugin.root,a):a);
   const r=spawnSync(process.execPath,resolved,{cwd:payload.cwd,input:JSON.stringify(payload),encoding:'utf8',timeout:30000,env});
   const result=JSON.parse(r.stdout||'{}');
   assert.equal(r.status,result.decision==='deny'?1:0,r.stderr);return result;
  });
 });
}
for(const reverse of [false,true]) test(`D3 registered hooks coexist in ${reverse?'workspace/core':'core/workspace'} order`,t=>{
 const d=fs.mkdtempSync(path.join(os.tmpdir(),'coexist-'));t.after(()=>fs.rmSync(d,{recursive:true,force:true}));
 const env={...process.env,HOME:d,USERPROFILE:d,LAZYNEON_OFFLINE:'1',LAZYNEON_WS_OFFLINE:'1',LAZYNEON_SELF_CHECK:'off',LAZYNEON_STOP_GUARD:'enforce',PYTHONDONTWRITEBYTECODE:'1'};
 const plugins=reverse?[...manifests].reverse():manifests;
 const payload={cwd:d,workspacePaths:[d],conversationId:'coexist',toolCall:{name:'read_file',args:{path:path.join(d,'note.txt')}},last_assistant_message:'검토 중입니다.'};
 fs.writeFileSync(path.join(d,'note.txt'),'normal data');
 for(const event of ['SessionStart','PreToolUse','PostToolUse','PreInvocation','Stop']) {
  const results=plugins.flatMap(plugin=>run(plugin,event,payload,env));
  assert.ok(results.length>0,event);
  assert.ok(results.every(r=>r.decision===undefined||r.decision==='allow'),JSON.stringify({event,results}));
  if(event==='SessionStart') assert.equal(results.filter(r=>r.injectSteps?.length).length,2);
 }
 for(const [file,content] of [['output.txt','x'.repeat(26000)],['evidence/original.txt','small']]) {
  const denied={...payload,toolCall:{name:'write_file',args:{TargetFile:path.join(d,file),content}}};
  const results=plugins.flatMap(plugin=>run(plugin,'PreToolUse',denied,env));
  // Host reduction must preserve a veto; an independent allow is not a global permit.
  assert.equal(results.some(r=>r.decision==='deny'),true,JSON.stringify(results));
  assert.equal(results.some(r=>r.decision==='continue'),false);
 }
});
