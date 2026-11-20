import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=join(dirname(fileURLToPath(import.meta.url)),'..');

/** Identity of the installed plugin, never the caller's workspace. Unknown Git data is null. */
export function pluginProvenance(pluginRoot=root) {
 let version='unknown';
 try {version=JSON.parse(readFileSync(join(pluginRoot,'plugin.json'),'utf8')).version || 'unknown';} catch {}
 const git=args=>{
  const r=spawnSync('git',['-C',pluginRoot,...args],{encoding:'utf8',timeout:1500,env:{...process.env,GIT_OPTIONAL_LOCKS:'0'}});
  return r.status===0&&!r.error&&!r.signal?r.stdout.trim():null;
 };
 const commit=git(['rev-parse','--verify','HEAD']);
 const status=commit?git(['status','--porcelain','--untracked-files=all']):null;
 return {version,commit,dirty:status===null?null:status.length>0};
}
export function provenanceLine(plugin=pluginProvenance()) {
 return `LazyNeon plugin ${plugin.version} commit ${plugin.commit ?? 'unknown'} dirty=${plugin.dirty ?? 'unknown'}`;
}
