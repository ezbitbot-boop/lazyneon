import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const read = p => readFileSync(new URL('../'+p, import.meta.url),'utf8');
const mod = () => import('../skills/ulw-research/scripts/access-method.mjs');
test('improve4 route selection and missing keys fail closed', async () => {
 const {selectRoutes, prepareRoute} = await mod();
 assert.ok(selectRoutes('https://www.reddit.com/r/node/').some(r=>r.id==='reddit-rss'));
 assert.equal(selectRoutes('https://reddit.com.evil.test/r/node/').length,0);
 assert.ok(selectRoutes('academic').some(r=>r.id==='crossref'));
 assert.deepEqual(prepareRoute('dart', {}, {}), {status:'skipped',note:'key missing: DART_API_KEY'});
 assert.ok(selectRoutes('academic',{caseMaterial:true}).every(r=>r.egress==='none'));
});
test('improve4 validators reject walls and retain small valid JSON', async () => {
 const {validateResponse} = await mod();
 for (const [body,why] of [['<title>Just a moment...</title>','challenge'],['<h1>Sign in to continue</h1>','auth_required'],['<title>Page not found</title>','not_found']]) assert.equal(validateResponse(200,body).outcome,why);
 assert.equal(validateResponse(200,'{"id":1}',{'content-type':'application/json'}).outcome,'ok');
 assert.equal(validateResponse(200,'{"error":"missing"}',{'content-type':'application/json'}).outcome,'invalid_content');
 assert.equal(validateResponse(429,'').outcome,'rate_limited');
});
test('improve4 consent and case material prevent every external attempt', async () => {
 const {accessUrl} = await mod();
 assert.equal((await accessUrl('https://127.0.0.1/')).status,'consent_required');
 assert.equal((await accessUrl('https://127.0.0.1/',{caseMaterial:true,consent:()=>true})).status,'local_only');
 assert.equal((await accessUrl('http://127.0.0.1/',{consent:()=>true})).status,'refused');
});
test('improve4 official transforms and reader require separate consent', async () => {
 const {officialAlternates, authorizeHop} = await mod();
 assert.ok(officialAlternates('https://www.reddit.com/r/node/').some(x=>x.url.endsWith('.rss')));
 assert.equal(officialAlternates('https://unknown.example/a').length,0);
 const seen=[];
 await assert.rejects(authorizeHop('https://r.jina.ai/https://example.com/',{consent:e=>{seen.push(e);return e.egress==='public';},egress:'third-party'}),/consent/);
 assert.equal(seen[0].egress,'third-party');
});
test('improve4 observation whitelist stores no content or URL paths', async () => {
 const {recordObservation} = await mod();
 const root=mkdtempSync(join(tmpdir(),'access-observation-'));
 const file=recordObservation(root,{url:'https://example.com/private?q=secret',route:'plain',outcome:'blocked',content:'secret'});
 const row=JSON.parse(readFileSync(file,'utf8'));
 assert.deepEqual(Object.keys(row).sort(),['host','outcome','route','timestamp']);
 assert.equal(row.host,'example.com');
 assert.doesNotMatch(JSON.stringify(row),/secret|private/);
});
test('improve4 route catalog covers families and privacy contract', () => {
 const rows=JSON.parse(read('skills/ulw-research/references/access-routes.json')).routes;
 for(const family of ['local','archives','korean','academic','code','community','knowledge','news','osint','search','images','platform']) assert.ok(rows.some(r=>r.family===family),family);
 for(const row of rows){assert.ok(row.purpose && row.tool && row.neverSend.length);assert.equal(typeof row.verified,'boolean');assert.ok(Array.isArray(row.keys));}
 assert.doesNotMatch(JSON.stringify(rows),/kakao|daum|urlscan/i);
 assert.match(read('skills/ulw-research/references/search-craft.md'),/ONLY.*client\/case/);
 assert.match(read('skills/ulw-research/references/search-craft.md'),/No-Site-Name Rule/);
});
test('improve4 provenance and release retain explicit port boundaries', () => {
 assert.equal(JSON.parse(read('package.json')).version,'0.4.4');
 assert.equal(JSON.parse(read('plugin.json')).version,'0.4.4');
 for(const p of ['skills/ulw-research/ATTRIBUTION.md','docs/SKILL-SOURCES.md','docs/skill-source-receipts.json']) assert.match(read(p),/access-method/);
 assert.match(read('skills/ulw-research/ATTRIBUTION.md'),/CAPTCHA solving/);
});

test('improve4 guarded chain checks redirects and third-party consent with offline wire fixtures', async t => {
 const https=await import('node:https');
 const {EventEmitter}=await import('node:events');
 const {PassThrough}=await import('node:stream');
 const {accessUrl}=await mod();
 const {guardedFetch}=await import('../skills/ulw-research/scripts/fetch-guard.mjs');
 let fixture, calls=[];
 t.mock.method(https.default,'request',(url,options,callback)=>{
  calls.push(String(url));const req=new EventEmitter();
  req.destroy=()=>{};
  req.end=()=>queueMicrotask(()=>{const res=new PassThrough();res.statusCode=fixture.status;res.headers=fixture.headers||{};callback(res);res.end(fixture.body||'');});
  return req;
 });
 fixture={status:302,headers:{location:'http://169.254.169.254/latest'}};
 await assert.rejects(guardedFetch('https://8.8.8.8/'),e=>e.code==='ssrf_blocked');
 assert.equal(calls.length,1);
 const root=mkdtempSync(join(tmpdir(),'access-chain-'));
 const old=process.env.LAZYNEON_OFFLINE;delete process.env.LAZYNEON_OFFLINE;
 try {
  calls=[];fixture={status:403,body:'Access denied'};
  const result=await accessUrl('https://8.8.8.8/',{root,browser:false,consent:e=>e.egress==='public'});
  assert.equal(result.status,'consent_required');assert.equal(calls.length,1);
  assert.equal(result.attempts[0].outcome,'blocked');
  calls=[];fixture={status:200,body:'<h1>Sign in to continue</h1>'};
  assert.equal((await accessUrl('https://8.8.8.8/',{root,consent:()=>true})).status,'blocked');assert.equal(calls.length,1);
  calls=[];fixture={status:403};
  assert.equal((await accessUrl('https://8.8.8.8/',{root,reader:false,browser:false,consent:()=>true,alternates:['http://127.0.0.1/']})).status,'refused');assert.equal(calls.length,1);
  const result2=await accessUrl('https://8.8.8.8/',{root,reader:false,browser:false,consent:()=>true});
  assert.match(result2.hint,/Phase 2.*ask/);
 } finally {if(old===undefined) delete process.env.LAZYNEON_OFFLINE;else process.env.LAZYNEON_OFFLINE=old;}
});

test('improve4 route execution enforces privacy before preparation and gates redirect egress class', async t => {
 const {accessRoute}=await mod();
 assert.equal(typeof accessRoute,'function');
 assert.equal((await accessRoute('dart',{}, {env:{}})).note,'key missing: DART_API_KEY');
 assert.equal((await accessRoute('npm',{query:'case secret'},{caseMaterial:true,consent:()=>true})).status,'local_only');
 assert.equal((await accessRoute('jina-reader',{raw_url:'http://127.0.0.1/'},{consent:()=>true})).status,'refused');
 const https=await import('node:https'),{EventEmitter}=await import('node:events'),{PassThrough}=await import('node:stream');
 let calls=0;
 t.mock.method(https.default,'request',(_url,_options,callback)=>{
  calls++;const req=new EventEmitter();req.destroy=()=>{};req.end=()=>queueMicrotask(()=>{const r=new PassThrough();r.statusCode=302;r.headers={location:'https://1.1.1.1/'};callback(r);r.end();});return req;
 });
 const {accessUrl}=await mod(),old=process.env.LAZYNEON_OFFLINE;delete process.env.LAZYNEON_OFFLINE;
 try {assert.equal((await accessUrl('https://8.8.8.8/',{consent:e=>e.egress==='public'})).status,'consent_required');assert.equal(calls,1);}
 finally {if(old===undefined) delete process.env.LAZYNEON_OFFLINE;else process.env.LAZYNEON_OFFLINE=old;}
});
