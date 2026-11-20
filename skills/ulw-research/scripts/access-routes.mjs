import {readFileSync} from 'node:fs';
export const routes=JSON.parse(readFileSync(new URL('../references/access-routes.json',import.meta.url),'utf8')).routes;
export function selectRoutes(input,{caseMaterial=false}={}) {
 if(caseMaterial) return routes.filter(r=>r.egress==='none');
 let host; try {host=new URL(input).hostname;} catch {return routes.filter(r=>r.family===input || r.id===input);}
 return routes.filter(r=>r.hosts.some(h=>host===h || host.endsWith('.'+h)));
}
export function prepareRoute(id,params={},env=process.env) {
 const r=routes.find(r=>r.id===id);
 if(!r) throw new Error('Unknown route');
 const missing=r.keys.filter(k=>!env[k]);
 if(missing.length) return {status:'skipped',note:'key missing: '+missing.join(', ')};
 // Keyed APIs require provider-specific authenticated adapters. Never interpolate secrets into URLs.
 if(r.keys.length || !r.endpoint || r.tool!=='GET') return {status:'guidance',route:r.id,note:r.tool};
 const url=r.endpoint.replace(/\{(\w+)\}/g,(_,k)=>{if(!params[k]) throw new Error('Missing public parameter: '+k);return k==='raw_url'?params[k]:encodeURIComponent(params[k]);});
 return {status:'ready',route:r.id,url,egress:r.egress};
}
export function officialAlternates(url) {
 const u=new URL(url);
 return selectRoutes(url).filter(r=>r.transform).map(r=>{
  const target=new URL(u);
  if(r.transform.kind==='suffix') target.pathname=target.pathname.replace(/\.(rss|json)$/,'').replace(/\/$/,'')+r.transform.value;
  if(r.transform.kind==='host') target.hostname=r.transform.value;
  return {route:r.id,url:r.transform.kind==='endpoint'?prepareRoute(r.id,{url}).url:target.href};
 }).filter(r=>r.url!==url);
}
