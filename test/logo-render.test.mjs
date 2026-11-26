import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const renderPng=path.join(root,'skills','logo-design','scripts','render_png.py');
const python=process.platform==='win32'?'python':'python3';
const env={...process.env,PYTHONDONTWRITEBYTECODE:'1'};
const LOGO='<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256"><circle cx="128" cy="128" r="96" fill="#0F7C80"/></svg>';

/** Colour type and top-left pixel of an 8-bit PNG. No PNG filter changes the first pixel: it has no left or upper neighbour. */
function firstPixel(file) {
 const png=fs.readFileSync(file);
 let ihdr; const idat=[];
 for(let pos=8;pos<png.length;) {
  const length=png.readUInt32BE(pos),type=png.toString('latin1',pos+4,pos+8),data=png.subarray(pos+8,pos+8+length);
  if(type==='IHDR') ihdr=data; else if(type==='IDAT') idat.push(data);
  pos+=12+length;
 }
 assert.equal(ihdr[8],8,'8-bit PNG');
 const colorType=ihdr[9],channels={0:1,2:3,4:2,6:4}[colorType];
 return {colorType,pixel:[...zlib.inflateSync(Buffer.concat(idat)).subarray(1,1+channels)]};
}

test('Quick Look never writes an opaque white PNG for a transparent logo',{skip:process.platform!=='darwin'&&'Quick Look (qlmanage) exists only on macOS'},t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'logo-render-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const svg=path.join(dir,'logo.svg');fs.writeFileSync(svg,LOGO);
 const render=(flags,out)=>spawnSync(python,[...flags,renderPng,svg,'-o',out,'--size','64','--backend','qlmanage'],{encoding:'utf8',env,timeout:120000});
 // -S hides site-packages and with it Pillow. Quick Look alone renders on opaque white, so it must refuse, not write.
 const bare=path.join(dir,'bare.png'),refused=render(['-S'],bare);
 assert.equal(refused.status,1,refused.stdout+refused.stderr);
 assert.equal(fs.existsSync(bare),false,'no PNG may be written');
 assert.match(refused.stderr,/qlmanage.*unavailable.*Pillow/);
 assert.doesNotMatch(spawnSync(python,['-S',renderPng,'--which'],{encoding:'utf8',env}).stdout,/qlmanage/,'--which must not offer Quick Look without Pillow');
 // With Pillow, Quick Look recovers transparency: the corner outside the circle is clear.
 if(spawnSync(python,['-c','import PIL'],{env}).status!==0) return t.diagnostic('Pillow not installed: the transparent Quick Look path is not exercised here');
 const full=path.join(dir,'full.png'),rendered=render([],full);
 assert.equal(rendered.status,0,rendered.stdout+rendered.stderr);
 const {colorType,pixel}=firstPixel(full);
 assert.equal(colorType,6,'RGBA');assert.equal(pixel[3],0,'transparent corner');
});

test('render_png prefers Google Chrome for Testing on macOS and falls back to Google Chrome',()=>{
 // Branded Google Chrome installs its updater during the first launches on a fresh macOS machine: ~21 s per launch on
 // CI runners. Chrome for Testing is the updater-free build for automation. Simulate which apps exist.
 const probe=`
import json, posixpath, sys
sys.path.insert(0, ${JSON.stringify(path.dirname(renderPng))})
import render_png as r
CFT = "/Applications/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing"
CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
r.os.path.isabs, r.shutil.which = posixpath.isabs, lambda name: None
found = {}
for case, apps in {"both": {CFT, CHROME}, "chrome only": {CHROME}}.items():
    r.os.path.exists = lambda p, apps=apps: p in apps
    found[case] = r.find_chrome()
print(json.dumps(found))`;
 const r=spawnSync(python,['-c',probe],{encoding:'utf8',env});
 assert.equal(r.status,0,r.stderr);
 assert.deepEqual(JSON.parse(r.stdout),{
  both:'/Applications/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing',
  'chrome only':'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
 });
});
