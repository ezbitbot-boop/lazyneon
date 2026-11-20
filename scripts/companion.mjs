import {readFileSync,readdirSync,realpathSync} from 'node:fs';
import {dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=join(dirname(fileURLToPath(import.meta.url)),'..');
// Inspect sibling manifests only: no imports, registration or network activity.
export function companionStatus(pluginRoot=root) {
 const missing={name:'lazyneon-workspace',installed:false,version:null,compatible:null};
 try {
  const parent=dirname(realpathSync(pluginRoot));
  for(const entry of readdirSync(parent,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name))) {
   if(!entry.isDirectory()&&!entry.isSymbolicLink()) continue;
   try {
    const manifest=JSON.parse(readFileSync(join(parent,entry.name,'plugin.json'),'utf8'));
    if(manifest.name!==missing.name) continue;
    const version=typeof manifest.version==='string'?manifest.version:'unknown';
    const parts=version.match(/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:\+[\w.-]+)?$/);
    const compatible=Boolean(parts&&(Number(parts[1])>0||Number(parts[2])>=1));
    return {...missing,installed:true,version,compatible};
   } catch { /* An unrelated or unreadable sibling is not a dependency. */ }
  }
 } catch {}
 return missing;
}
export function companionLine(status=companionStatus(),context='doctor') {
 if(!status.installed) return context==='session'?'':'Optional lazyneon-workspace: forensic/legal skills not installed';
 return `Companion lazyneon-workspace ${JSON.stringify(status.version)}: ${status.compatible?'compatible':'WARN incompatible/unknown'} (requires >=0.1.0, optional)`;
}
