import {appendFileSync, mkdirSync, existsSync} from 'node:fs';
import {join} from 'node:path';
import {lookup} from 'node:dns/promises';
import {isIP} from 'node:net';
import {guardedFetch, isBlockedIp, GuardError, injectionSignals} from './fetch-guard.mjs';
import {routes, selectRoutes, prepareRoute, officialAlternates} from './access-routes.mjs';
import {validateResponse} from './access-validation.mjs';
// Offline comes from LAZYNEON_OFFLINE or config/local.json "offline" (environment wins).
import {settings} from '../../../scripts/settings.mjs';
export {selectRoutes, prepareRoute, officialAlternates, validateResponse};

export async function authorizeHop(url,{consent,egress='public',caseMaterial=false}={}) {
 if(caseMaterial) throw new GuardError('local_only','client/case material must remain local');
 const u=new URL(url);
 if(!['https:','http:'].includes(u.protocol) || u.username || u.password) throw new GuardError('scheme_blocked','Public HTTP(S) URL without credentials required');
 if(!consent || await consent({url:u.href,host:u.hostname,egress})!==true) throw new GuardError('consent_required','Explicit egress consent required for this hop');
 const host=u.hostname.replace(/^\[|\]$/g,'');
 if(isIP(host) && isBlockedIp(host)) throw new GuardError('ssrf_blocked','Internal address refused');
}
async function checkReaderTarget(url) {
 const u=new URL(url),host=u.hostname.replace(/^\[|\]$/g,'');
 const addresses=isIP(host)?[{address:host}]:await lookup(host,{all:true});
 if(!addresses.length || addresses.some(a=>isBlockedIp(a.address))) throw new GuardError('ssrf_blocked','Reader target must resolve publicly');
}
export function recordObservation(root,{url,route,outcome}) {
 // Fixed location beneath the already gitignored .lazyneon directory. No URLs, queries, bodies or hints.
 const dir=join(root,'.lazyneon','observations');mkdirSync(dir,{recursive:true});
 const file=join(dir,'access.jsonl');
 const allowedRoute=['plain','alternate','reader','browser',...routes.map(r=>r.id)];
 const allowedOutcome=['ok','blocked','challenge','auth_required','not_found','rate_limited','empty_content','invalid_content','unavailable','error','consent_required','refused'];
 appendFileSync(file,JSON.stringify({host:new URL(url).hostname,route:allowedRoute.includes(route)?route:'alternate',timestamp:new Date().toISOString(),outcome:allowedOutcome.includes(outcome)?outcome:'error'})+'\n',{mode:0o600});
 return file;
}
async function browserFetch(url,request) {
 let playwright;try {playwright=await import('playwright');} catch(e) {if(e.code==='ERR_MODULE_NOT_FOUND') return null;throw e;}
 const browser=await playwright.chromium.launch({headless:true});
 try {
  const context=await browser.newContext({serviceWorkers:'block',acceptDownloads:false});
  // Old Playwright cannot intercept WebSockets: fail closed, never use direct network.
  if(typeof context.routeWebSocket!=='function') return null;
  await context.routeWebSocket('**/*',socket=>socket.close());
  let denied;
  await context.route('**/*',async route=>{
   try {
    if(route.request().method()!=='GET') return await route.abort();
    const res=await request(route.request().url());
    const headers=Object.fromEntries(res.headers);delete headers['content-length'];delete headers['content-encoding'];
    await route.fulfill({status:res.status,headers,body:Buffer.from(await res.arrayBuffer())});
   } catch(e) {denied=e;await route.abort();}
  });
  const page=await context.newPage();
  const response=await page.goto(url,{waitUntil:'networkidle',timeout:20000});
  if(denied) throw denied;
  return {status:response?.status()||200,text:await page.content(),headers:{'content-type':'text/html'}};
 } finally {await browser.close();}
}

/** Ordinary public access only. A consent callback is the adapter to the host's existing egress gate.
 * No standing bypass-consent promotion. CLI tools in the index are guidance, never subprocesses.
 */
export async function accessUrl(url,{consent,caseMaterial=false,root=process.cwd(),reader=true,browser=true,alternates=[],egress='public'}={}) {
 if(caseMaterial || existsSync(join(root,'CASE_MATERIAL'))) return {status:'local_only',note:'Use local routes for client/case material'};
 const attempts=[];
 const request=(target,kind=egress)=>guardedFetch(target,{beforeHop:hop=>authorizeHop(hop,{consent,egress:kind==='third-party'||new URL(hop).origin!==new URL(url).origin?'third-party':'public'})});
 const record=(route,got)=>{
  const verdict=validateResponse(got.status,got.text,got.headers);
  attempts.push({route,...verdict});recordObservation(root,{url,route,outcome:verdict.outcome});
  return verdict;
 };
 const success=(got,route)=>({status:'ok',route,text:got.text,contentTrust:'untrusted_public_web',injectionSignals:injectionSignals(got.text),attempts});
 try {
  await authorizeHop(url,{consent,egress});
  if(settings().offline) return {status:'offline',attempts};
  const targets=[{route:'plain',url},...officialAlternates(url),...alternates.slice(0,4).map(a=>({route:'alternate',url:a}))];
  for(const target of targets) {
   const response=await request(target.url);
   const got={status:response.status,text:await response.text(),headers:response.headers};
   const verdict=record(target.route,got);
   if(verdict.outcome==='ok') return success(got,target.route);
   if(['auth_required','not_found','rate_limited'].includes(verdict.outcome)) return {status:'blocked',attempts,hint:'Stop. Provide an authorized public source or a local copy; do not bypass this wall.'};
  }
  if(reader) {
   // Both the source and reader hop need authorization; never proxy an internal target.
   await checkReaderTarget(url);
   const target=prepareRoute('jina-reader',{raw_url:url}).url;
   const response=await request(target,'third-party');
   const got={status:response.status,text:await response.text(),headers:response.headers};
   if(record('reader',got).outcome==='ok') return success(got,'reader');
  }
  if(browser) {
   const got=await browserFetch(url,target=>request(target,new URL(target).origin===new URL(url).origin?'public':'third-party'));
   if(got && record('browser',got).outcome==='ok') return success(got,'browser');
   if(!got) attempts.push({route:'browser',outcome:'unavailable'});
  }
  return {status:'blocked',attempts,hint:'Phase 2: stop and ask the user for an official alternate URL, public source hint, or local copy.'};
 } catch(e) {
  const status=e.code==='consent_required'?'consent_required':['ssrf_blocked','scheme_blocked'].includes(e.code)?'refused':'error';
  return {status,attempts,note:e.code||'access_failed',hint:'Stop and ask for a permitted public route or local copy.'};
 }
}


/** Execute an indexed public GET through the same guard. Keyed/uncertain adapters stay guidance-only. */
export async function accessRoute(id,params={},options={}) {
 if(options.caseMaterial || existsSync(join(options.root||process.cwd(),'CASE_MATERIAL'))) return {status:'local_only'};
 const r=routes.find(r=>r.id===id);
 if(!r) throw new Error('Unknown route');
 const prepared=prepareRoute(id,params,options.env||process.env);
 if(prepared.status!=='ready') return prepared;
 // Proxy/archive queries must not conceal an internal target in a public URL.
 try {
  for(const key of ['url','raw_url']) if(params[key]) {
   await authorizeHop(params[key],{consent:options.consent,egress:r.egress});
   if(!settings().offline) await checkReaderTarget(params[key]);
  }
 } catch(e) {return {status:e.code==='consent_required'?'consent_required':'refused',note:e.code||'target_invalid'};}
 return accessUrl(prepared.url,{...options,egress:r.egress,reader:false});
}
