import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
const root=process.cwd();
test('R10 first verification runs real entrypoints in Korean paths with spaces and detects broken entrypoint',t=>{
 const dir=fs.mkdtempSync(path.join(root,'.r10 한글 case '));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const run=(script,args=[],input='{}')=>spawnSync(process.execPath,[path.join(root,script),...args],{cwd:dir,encoding:'utf8',input,env:{...process.env,LAZYNEON_OFFLINE:'1',LAZYNEON_NO_AUTO_UPDATE:'1'}});
 const c=run('scripts/classify-task.mjs',[],'증거 폴더 해시 목록 만들어줘');assert.equal(c.status,0,c.stderr);assert.equal(JSON.parse(c.stdout).kind,'count_extract');
 fs.writeFileSync(path.join(dir,'보고서.json'),'{');
 const g=run('scripts/json_schema_guard.mjs',[],JSON.stringify({cwd:dir,toolCall:{name:'exec_command',args:{cmd:'cp input.json 보고서.json'}}}));assert.equal(g.status,1);assert.match(g.stderr,/FAIL/);
 const broken=run('scripts/nonexistent-entry.mjs');assert.notEqual(broken.status,0);assert.throws(()=>JSON.parse(broken.stdout));
 const ci=fs.readFileSync(path.join(root,'.github/workflows/core-tests.yml'),'utf8');for(const os of ['ubuntu-latest','macos-latest','windows-latest'])assert.ok(ci.includes(os));
});
