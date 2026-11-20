/** Shell inspection only; never execute input. Unknown computed writes stay unchecked. */
import fs from 'node:fs';
import path from 'node:path';
export function shellTokens(command) {
 const tokens=[]; let word='', quote='', started=false;
 const flush=()=>{if(started)tokens.push(word);word='';started=false;};
 for(let i=0;i<command.length;i++){
  const c=command[i];
  if(quote){if(c===quote)quote='';else if(c==='\\'&&quote==='"'&&/["\\$`]/.test(command[i+1]||''))word+=command[++i];else word+=c;continue;}
  if(c==='"'||c==="'"){quote=c;started=true;continue;}
  if(c==='\\'&&/[\s'"|;&<>\\]/.test(command[i+1]||'')){word+=command[++i];started=true;continue;}
  if(/\s/.test(c)){flush();continue;}
  if(/[|;&<>]/.test(c)){flush();let op=c;if(command[i+1]===c)op+=command[++i];tokens.push(op);continue;}
  word+=c;started=true;
 }
 flush(); return {tokens, incomplete:!!quote};
}
export function shellWrites(command, workspace=process.cwd(), {contentOnly=false}={}) {
 const {tokens,incomplete}=shellTokens(command);const targets=new Set();let write=false,unknown=false;
 const add=p=>{write=true;if(!p||/[$`*?]/.test(p)){unknown=true;return;}targets.add(path.resolve(workspace,p));};
 const groups=[];let group=[];
 for(const token of tokens){if(['|','||','&&',';','&'].includes(token)){groups.push(group);group=[];}else group.push(token);}groups.push(group);
 for(let args of groups){
  const clean=[];
  for(let i=0;i<args.length;i++){
   if(['>','>>'].includes(args[i])){if(args[i+1]==='&'){i+=2;continue;}add(args[++i]);}
   else if(['<','<<'].includes(args[i]))i++;
   else clean.push(args[i]);
  }
  args=clean;while(/^\w+=/.test(args[0]||''))args.shift();if(args[0]==='sudo')args.shift();
  const verb=path.basename(args.shift()||'').toLowerCase().replace(/\.exe$/,'');
  const operands=[];let targetDir=null;
  for(let i=0;i<args.length;i++){
   const a=args[i];
   if(['cp','mv','install','rsync'].includes(verb)&&/^(?:-t|--target-directory)(?:=|$)/.test(a)){targetDir=a.includes('=')?a.slice(a.indexOf('=')+1):args[++i];continue;}
   if(!a.startsWith('-')||a==='-')operands.push(a);
  }
  if(['cp','mv','install','rsync'].includes(verb)){
   write=true;const dest=targetDir??operands.pop();let directory=!!targetDir||/[\\/]$/.test(dest||'');
   try{directory ||= fs.statSync(path.resolve(workspace,dest)).isDirectory();}catch{}
   if(!dest||!operands.length){unknown=true;continue;}
   if(directory){for(const src of operands)add(path.join(dest,path.basename(src)));}else add(dest);
   if(verb==='mv'&&!contentOnly)operands.forEach(add);
  }else if(verb==='rm'||(verb==='git'&&args[0]==='rm')){write=true;if(!contentOnly)operands.filter(p=>p!=='rm').forEach(add);}
  else if(verb==='tee'){write=true;operands.forEach(add);if(!operands.length)unknown=true;}
  else if(verb==='dd'){write=true;const output=args.find(a=>a.startsWith('of='));if(output)add(output.slice(3));else unknown=true;}
  else if(verb==='sed'&&args.some(a=>a==='--in-place'||a.startsWith('--in-place=')||/^-i/.test(a))){write=true;let rest=[...args];const ix=rest.findIndex(a=>a.startsWith('-i')||a.startsWith('--in-place'));const flag=rest.splice(ix,1)[0];if(flag==='-i'&&rest[ix]==='')rest.splice(ix,1);let expression=false;for(let i=0;i<rest.length;i++){if(['-e','-f'].includes(rest[i])){i++;expression=true;}else if(!rest[i].startsWith('-')){if(!expression)expression=true;else add(rest[i]);}}}
  else if(verb==='ffmpeg'){write=true;for(let i=0;i<args.length;i++){if(args[i].startsWith('-')){if(!['-y','-n','-an','-vn'].includes(args[i]))i++;}else add(args[i]);}}
  else if(['pandoc','sort','curl','wget','lazyforensic','lazyothers','case-mode'].includes(verb)||args.some(a=>a==='--session-dir')){
   for(let i=0;i<args.length;i++)if(/^(?:-o|--output|--markdown|--out|--session-dir)(?:=|$)/.test(args[i]))add(args[i].includes('=')?args[i].slice(args[i].indexOf('=')+1):args[++i]);
  }
  // Literal interpreter file writes; do not infer outputs from read input arguments.
  const code=args.join(' ');
  if((/\.write\s*\(/.test(code)&&/\bopen\s*\(/.test(code))||/\b(?:writeFile(?:Sync)?|File\.write|write_text|write_bytes|open\s*\([^)]*[, ]\s*['"]?[wax])/.test(code)){
   write=true;let found=false;
   for(const m of code.matchAll(/(?:writeFile(?:Sync)?|File\.write)\s*\(\s*['"]([^'"]+)['"]\s*,/g)){add(m[1]);found=true;}
   for(const m of code.matchAll(/open\s*\(\s*['"]([^'"]+)['"]\s*,\s*['"][wax][^'"]*['"]/g)){add(m[1]);found=true;}
   for(const m of code.matchAll(/Path\s*\(\s*['"]([^'"]+)['"]\s*\)\.write_(?:text|bytes)\s*\(/g)){add(m[1]);found=true;}
   if(!found)unknown=true;
  }
 }
 return {targets:[...targets],write,unknown:unknown||(incomplete&&write)};
}
