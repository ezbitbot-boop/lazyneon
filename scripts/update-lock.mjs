import {openSync,closeSync,readFileSync,writeFileSync,unlinkSync,statSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
const STALE_MS=60000;
function alive(pid) {
 try {process.kill(pid,0);return true;} catch(error) {return error.code!=='ESRCH';}
}
// Recovery is serialized too, so two reclaimers cannot unlink a fresh owner's lock.
export function acquireUpdateLock(file,{now=Date.now(),isAlive=alive}={}) {
 const token=randomUUID();
 const create=()=>{
  const fd=openSync(file,'wx',0o600);
  try {writeFileSync(fd,JSON.stringify({pid:process.pid,created:now,token}));} finally {closeSync(fd);}
  return ()=>{try {if(JSON.parse(readFileSync(file,'utf8')).token===token) unlinkSync(file);} catch {}};
 };
 try {return create();} catch(error) {if(error.code!=='EEXIST') return null;}
 let recovery;
 try {
  recovery=acquireUpdateLock(`${file}.recover`,{now,isAlive});
  if(!recovery) return null;
  const stat=statSync(file);const text=readFileSync(file,'utf8');let record;
  try {record=JSON.parse(text);} catch {}
  const valid=Number.isInteger(record?.pid)&&record.pid>0&&Number.isFinite(record.created);
  const created=valid?record.created:stat.mtimeMs;
  if(now-created<STALE_MS||now<created||(valid&&isAlive(record.pid))) return null;
  // Empty legacy locks and incomplete records have no process identity; age bounds recovery.
  if(readFileSync(file,'utf8')!==text) return null;
  unlinkSync(file);
  return create();
 } catch {return null;}
 finally {recovery?.();}
}
