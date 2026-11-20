import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { hookTargets } from '../scripts/hook_targets.mjs';
const root=process.cwd();
const env={...process.env,LAZYNEON_OFFLINE:'1',LAZYNEON_NO_AUTO_UPDATE:'1',ANTIGRAVITY_MODEL_NAME:'unknown',ANTIGRAVITY_MODEL:'',GEMINI_MODEL:''};
function run(script,args=[],payload={},extra={}) { return spawnSync(process.execPath,[path.join(root,script),...args],{env:{...env,...extra},input:JSON.stringify(payload),encoding:'utf8'}); }
function fixture(t){const d=fs.mkdtempSync(path.join(root,'.r10-'));t.after(()=>fs.rmSync(d,{recursive:true,force:true}));return d;}
function targets(command,cwd=root,contentOnly=false){return hookTargets([{parsed:{cwd,toolCall:{name:'exec_command',args:{command}}}}],{contentOnly});}
test('R10 routing sufficient Neon executes in session without claiming PASS',()=>{
 for(const prompt of ['증거 폴더 해시 목록 만들어줘','이 감정보고서 검토해줘','개인정보 마스킹해줘','이 코드 리뷰해줘','작업 계획 세워줘','이 사진 위변조 여부 판단해줘']){
  const r=run('scripts/classify-task.mjs',[prompt],{},{ANTIGRAVITY_MODEL_NAME:'gemini-4-neon-xhigh'}); assert.equal(r.status,0,r.stderr);const c=JSON.parse(r.stdout);
  assert.doesNotMatch(c.action,/refuse/);assert.ok(c.gate_results.every(g=>g.status==='pending'&&g.execution==='in_session'));
  if(prompt.includes('해시')){assert.equal(c.kind,'count_extract');assert.equal(c.gate_results.length,0);}
 }
 const c=JSON.parse(run('scripts/classify-task.mjs',['최종 리뷰해줘']).stdout);assert.match(c.action,/^proceed in session/);assert.equal(c.gate_results[0].status,'pending');
});
test('R10 shell destinations are semantic and preserve spaces and directory copies',t=>{
 const d=fixture(t);fs.mkdirSync(path.join(d,'reports'));
 for(const [cmd,expected] of [
 ['cp draft.md report.md',['report.md']],['cp a.md b.json reports/',['reports/a.md','reports/b.json']],
 ['sed -i "s/a/b/" report.md',['report.md']],['echo x > "report final.md"',['report final.md']],
 ['cat x | tee reports/r.md',['reports/r.md']],['pandoc in.md -o reports/r.md',['reports/r.md']],
 ['grep -o 계약금 evidence/chat.txt',[]],['sort -t , -k2 reports/x.csv',[]],
 ['ffmpeg -i in.mp4 -t 30 reports/clip.mp4',['reports/clip.mp4']],
 ['rm reports/old.md',[]],['git rm reports/old.md',[]],['ls reports/missing.md',[]],
 ['python3 tools/verify.py reports/a.md',[]],['test -f reports/x.json || echo none',[]],
 ])assert.deepEqual(targets(cmd,d,true).map(p=>path.relative(d,p)),expected,cmd);
});
test('R10 patchText and arbitrary patch keys collect every operation',()=>{
 for(const key of ['patchText','body','input'])for(const op of ['Add File','Update File','Delete File','Move to']){
 const p={toolCall:{name:'apply_patch',args:{[key]:`*** ${op}: evidence/chat.txt`}}};
 assert.deepEqual(hookTargets([{parsed:p}]),[path.join(root,'evidence/chat.txt')]);
 }
});
for(const prefix of ['py -c','php -r','bun -e','deno eval','node -p','osascript -e',"python3 - <<'EOF'\n",'printf %s'])test('R10 command limit '+prefix,()=>{
 for(const n of [1000,30000]){const command=prefix+` "${'x'.repeat(n)}" | dd of=/tmp/a`;const r=run('scripts/write_chunk_guard.mjs',[],{toolCall:{name:'run_command',args:{command}}});assert.equal(JSON.parse(r.stdout).decision,n>24000?'deny':undefined);}
});
function host(payload,extra={}){
 const hooks=JSON.parse(fs.readFileSync('hooks.json','utf8')).hooks;
 for(const entry of hooks.PostToolUse)if(new RegExp(entry.matcher).test(payload.toolCall.name))for(const h of entry.hooks){const [node,...args]=h.command.split(/\s+/);assert.equal(node,'node');const r=run(args[0],args.slice(1),payload,extra);assert.equal(r.status,0,r.stderr);}
 const r=run('scripts/post_tool_feedback.mjs',['inject'],payload,extra);assert.equal(r.status,0,r.stderr);return JSON.parse(r.stdout);
}
test('R10 real hook relay reads and deletion quiet, malformed writes fail',t=>{
 const d=fixture(t),extra={LAZYNEON_FEEDBACK_DIR:path.join(d,'feedback')};
 for(const command of ['rm reports/old.md','git rm reports/old.md','ls reports/missing.md','python3 tools/verify.py reports/a.md','test -f reports/x.json || echo none','sha256sum evidence/chat.txt','grep -o 계약금 evidence/chat.txt','sort -t , -k2 reports/x.csv','exiftool -j evidence/photo.jpg'])assert.deepEqual(host({cwd:d,conversationId:'r10',toolCall:{name:'run_command',args:{command}}},extra),{},command);
 fs.writeFileSync(path.join(d,'bad.json'),'{');fs.writeFileSync(path.join(d,'good.json'),'{}');
 for(const name of ['exec_command','run_command','Bash','search_update','search_replace','apply_patch']){
  const args=/command|Bash/.test(name)?{command:'cp draft.json bad.json'}:name==='apply_patch'?{patchText:'*** Update File: bad.json'}:{path:'bad.json'};
  assert.match(JSON.stringify(host({cwd:d,conversationId:'r10',toolCall:{name,args}},extra)),/guard_failed/,name);
 }
 assert.deepEqual(host({cwd:d,conversationId:'r10',toolCall:{name:'exec_command',args:{command:'cp draft.json good.json'}}},extra),{});
});
test('R10 claims absolute and relative evidence are inputs, session is output',t=>{
 const d=fixture(t);for(const input of ['evidence/판결문.txt',path.join(d,'evidence/판결문.txt')]){
 const cmd=`node skills/ulw-research/scripts/report-tools.mjs claims snapshot --session-dir "${d}/session" --from "S3=${input}"`;
 assert.deepEqual(targets(cmd,d),[path.join(d,'session')]);
 }
});
test('R10 unknown writes report unchecked and read MCP stays quiet',t=>{
 const d=fixture(t),extra={LAZYNEON_FEEDBACK_DIR:path.join(d,'feedback')};
 for(const name of ['mcp__github__get_issue','mcp__memory__read_graph','mcp__kordoc__parse_document'])assert.deepEqual(host({cwd:d,conversationId:'r10',toolCall:{name,args:{path:'missing.md'}}},extra),{});
 const result=host({cwd:d,conversationId:'r10',toolCall:{name:'exec_command',args:{command:'python3 -c "open(destination, mode).write(data)"'}}},extra);
 assert.match(JSON.stringify(result),/미확인/);assert.doesNotMatch(JSON.stringify(result),/guard_failed|PASS/);
});
test('R10 actual claims snapshot preserves absolute and relative evidence bytes',t=>{
 const d=fixture(t);fs.mkdirSync(path.join(d,'evidence'));fs.mkdirSync(path.join(d,'session'));
 const evidence=path.join(d,'evidence','판결문.txt'),session=path.join(d,'session');const text='판결문 원문: 증거 해시를 변경하지 않는다.';
 fs.writeFileSync(evidence,text);fs.writeFileSync(path.join(session,'CASE_MATERIAL'),'');fs.writeFileSync(path.join(session,'claims.jsonl'),'');
 fs.writeFileSync(path.join(session,'sources.jsonl'),JSON.stringify({id:'S3',type:'case_material',url:'file://case'}));
 for(const input of [evidence,path.relative(root,evidence)]){
 const r=run('skills/ulw-research/scripts/report-tools.mjs',['claims','snapshot','--session-dir',session,'--from',`S3=${input}`]);
 assert.equal(r.status,0,r.stderr);assert.equal(fs.readFileSync(evidence,'utf8'),text);assert.equal(fs.readFileSync(path.join(session,'sources/snapshots/S3.txt'),'utf8'),text);
 }
 const denied=run('skills/ulw-research/scripts/report-tools.mjs',['claims','snapshot','--session-dir',session,'--from',`S3=${evidence}`,'--allow-bypass']);assert.notEqual(denied.status,0);assert.match(denied.stderr,/CASE_MATERIAL/);
});
test('R10 independent hook contract detects matcher removal and malformed writes',()=>{
 const supported=['write_file','write_to_file','edit_file','replace_file_content','search_update','search_replace','apply_patch','exec_command','run_command','Bash'];
 const hooks=JSON.parse(fs.readFileSync('hooks.json','utf8')).hooks;
 const check=h=>{for(const stage of ['PreToolUse','PostToolUse'])for(const name of supported)assert.ok(h[stage].some(e=>new RegExp(e.matcher).test(name)&&e.hooks.some(x=>x.command.includes(stage==='PreToolUse'?'write_chunk_guard.mjs':'markdown_structure_guard.mjs'))),`${stage}: ${name}`);};
 check(hooks);
 for(const stage of ['PreToolUse','PostToolUse']){const broken=structuredClone(hooks);broken[stage][0].matcher='^write_file$';assert.throws(()=>check(broken));}
});
test('R10 interpreter outputs exclude file reads and standard output',()=>{
 assert.deepEqual(targets(`python3 -c "print(open('evidence/a.txt', 'r').read())"`),[]);
 assert.deepEqual(targets(`python3 -c "import sys; sys.stdout.write('hello')"`),[]);
 assert.deepEqual(targets(`python3 -c "open('report.md', 'w').write(open('evidence/a.txt', 'r').read())"`),[path.join(root,'report.md')]);
 assert.deepEqual(targets(`python3 -c "Path('report.md').write_text('x')"`),[path.join(root,'report.md')]);
});
