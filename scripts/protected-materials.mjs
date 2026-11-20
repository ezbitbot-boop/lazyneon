import path from 'node:path';
const protectedKind=/^(?:pii|sensitive|security_audit|forensic_verdict|evidence|forensic|pii_inject_docfmt)$/i;
const signals=/\b(?:pii|evidence|forensic|sensitive\s+data)\b|증거|개인정보|민감정보|주민등록|보안\s*감사/i;
function normalized(value) {return String(value).replaceAll('\\','/').normalize('NFC');}
function under(file,root,cwd) {
 const win=/^(?:[A-Za-z]:|\/\/)/.test(file)||/^(?:[A-Za-z]:|\/\/)/.test(root);
 const api=win?path.win32:path.posix;
 const f=api.resolve(cwd,file);const r=api.resolve(cwd,root);const rel=api.relative(r,f);
 return rel===''||(!rel.startsWith(`..${api.sep}`)&&rel!=='..'&&!api.isAbsolute(rel));
}
export function protectedMaterials(prompt,payload={},matchedKinds=[]) {
 if(matchedKinds.some(k=>protectedKind.test(k))||protectedKind.test(payload.kind??'')||signals.test(prompt)) return true;
 const roots=Array.isArray(payload.evidence_roots)?payload.evidence_roots:[];
 const cwd=normalized(payload.cwd??process.cwd());
 const texts=[prompt];
 const visit=value=>{
  if(typeof value==='string') texts.push(value);
  else if(Array.isArray(value)) value.forEach(visit);
  else if(value&&typeof value==='object') {
   if(protectedKind.test(value.kind??'')) texts.push('evidence');
   Object.values(value).forEach(visit);
  }
 };
 visit(payload.materials);visit(payload.paths);visit(payload.files);
 return texts.some(text=>{
  const p=normalized(text);
  return signals.test(p)||/(?:^|\/)(?:evidence|증거)(?:\/|$)/i.test(p)
   ||roots.some(root=>typeof root==='string'&&under(p,normalized(root),cwd));
 });
}
