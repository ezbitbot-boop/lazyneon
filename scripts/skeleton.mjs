// Hydrogen code navigation only. AST/LSP ranges are locations, never substitute evidence.
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {isMainModule} from './is-main.mjs';
import {resolveSessionModel} from './session-model.mjs';
export async function readSkeleton(file,{model,lsp}={}) {
 if(!/^gemini-4-hydrogen(?:-|$)/.test(model??'')) throw Error('Hydrogen search-only reader; Neon must read original evidence');
 const source=fs.readFileSync(file,'utf8');
 if(typeof lsp==='function') {
  const symbols=await lsp(file);
  if(Array.isArray(symbols)) return {source:'LSP',symbols,search_only:true,body_read_required:true};
 }
 if(path.extname(file)==='.py') {
  const code=`import ast,json,sys
t=ast.parse(sys.stdin.read())
out=[]
def visit(n,prefix=""):
 for c in ast.iter_child_nodes(n):
  name=prefix
  if isinstance(c,(ast.FunctionDef,ast.AsyncFunctionDef,ast.ClassDef)):
   name=prefix+c.name
   out.append(dict(name=c.name,qualified=name,start=min([c.lineno]+[d.lineno for d in c.decorator_list]),end=c.end_lineno))
   name+="."
  visit(c,name)
visit(t)
print(json.dumps(out))`;
  let r;
  for(const [exe,args] of [['python3',[]],['python',[]],['py', ['-3']]]) {
   r=spawnSync(exe,[...args,'-c',code],{input:source,encoding:'utf8'});
   if(!r.error&&r.status===0) break;
  }
  if(r.status!==0) throw Error(r.stderr||'AST reader unavailable');
  return {source:'AST',symbols:JSON.parse(r.stdout),search_only:true,body_read_required:true};
 }
 // No regex brace parser: strings/templates/comments make its end ranges unsafe.
 return {source:'unavailable',symbols:[],search_only:true,body_read_required:true,
  instruction:'Use host LSP document symbols or read the full source; AST parser unavailable'};
}
export function readBody(file,symbol) {
 const lines=fs.readFileSync(file,'utf8').split(/\r?\n/);
 if(!Number.isInteger(symbol.start)||!Number.isInteger(symbol.end)||symbol.start<1||symbol.end<symbol.start||symbol.end>lines.length) throw Error('invalid body range; reread source');
 return lines.slice(symbol.start-1,symbol.end).join('\n');
}
if(isMainModule(import.meta.url)) {
 try {
  const [file,flag,name]=process.argv.slice(2);
  const result=await readSkeleton(file,{model:resolveSessionModel()});
  if(flag==='--body') {
   const candidates=result.symbols.filter(s=>s.name===name||s.qualified===name);
   if(candidates.length>1) throw Error('ambiguous symbol: '+candidates.map(s=>s.qualified??s.name).join(', '));
   const symbol=candidates[0]; if(!symbol) throw Error('symbol unavailable; read full source');
   console.log(readBody(file,symbol));
  } else console.log(JSON.stringify(result,null,2));
 } catch(e) {console.error(e.message);process.exitCode=1;}
}
