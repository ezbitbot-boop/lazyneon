// Regressions for the 2026-11-26 verification defects (offline, temp repos only).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {updatePlugin} from '../scripts/update.mjs';

const git=(cwd,...args)=>execFileSync('git',['-c','user.email=t@example.com','-c','user.name=t',...args],{cwd,encoding:'utf8',stdio:['ignore','pipe','pipe']});

test('update refuses to overwrite an ignored local file and leaves it intact', () => {
  const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'ln-update-'));
  try {
    git(tmp,'init','-q','--bare','-b','main','up.git');
    git(tmp,'clone','-q','up.git','work');const work=path.join(tmp,'work');
    git(work,'checkout','-q','-B','main');
    fs.writeFileSync(path.join(work,'.gitignore'),'config/issuer.json\n');
    git(work,'add','-A');git(work,'commit','-qm','base');git(work,'push','-q','origin','main');
    git(tmp,'clone','-q','up.git','plugin');const plugin=path.join(tmp,'plugin');
    fs.mkdirSync(path.join(plugin,'config'));fs.writeFileSync(path.join(plugin,'config/issuer.json'),'{"local":"owner"}');
    fs.mkdirSync(path.join(work,'config'));fs.writeFileSync(path.join(work,'config/issuer.json'),'{"upstream":"x"}');
    git(work,'add','-f','config/issuer.json');git(work,'commit','-qm','up');git(work,'push','-q','origin','main');
    const before=git(plugin,'rev-parse','HEAD');
    let out='';
    assert.throws(()=>updatePlugin(plugin,{LAZYNEON_OFFLINE:'0'},{write:s=>{out+=s;}}),/ignored local files/);
    assert.equal(fs.readFileSync(path.join(plugin,'config/issuer.json'),'utf8'),'{"local":"owner"}');
    assert.equal(git(plugin,'rev-parse','HEAD'),before);
  } finally { fs.rmSync(tmp,{recursive:true,force:true}); }
});
