// Only the installer-controlled hook environment may relax write limits.
export function trustedHost() {
 try {return JSON.parse(process.env.LAZYNEON_TRUSTED_HOST || '{}');} catch {return {};}
}
export function hostLimits(host={}) {
 const e=host.evidence;
 const valid=e&&e.source&&host.version&&e.version===host.version;
 const writeLimit=(key,fallback)=>!valid?fallback:e[key]==='unlimited'?Infinity:
  Number.isFinite(e[key])&&e[key]>0?e[key]:fallback;
 return {max_write_bytes:writeLimit('max_write_bytes',24576),
  max_write_lines:writeLimit('max_write_lines',250),
  context_limit:valid&&Number.isFinite(e.max_context_tokens)&&e.max_context_tokens>0?Math.min(1048576,e.max_context_tokens):1048576,
  idle_timeout_sec:valid?e.idle_timeout_sec??null:null,deadline_sec:valid?e.deadline_sec??null:null};
}
export function contextReserve(host,usage) {
 const limit=hostLimits(host).context_limit;
 const values=['input','thinking','tools','output_reserve'].map(k=>usage[k]);
 if(values.some(v=>!Number.isFinite(v)||v<0)) return {remaining:null,checkpoint:true,measurement:'[미측정]'};
 const remaining=limit-values.reduce((a,b)=>a+b,0);
 return {remaining,checkpoint:remaining<=0||Boolean(host.compact_event)};
}
// Host adapter returns text deltas, not cumulative snapshots. No manual "continue" prompts.
export async function continueOutput(first,request,{max_hops=100,previous_interaction_id,supports_previous_interaction_id=false,host={},context_usage}={}) {
 let part=first,text='',hops=0; const seen=new Set();
 for(;;) {
  if(context_usage&&contextReserve(host,context_usage).checkpoint) return {text,complete:false,reason:'context_checkpoint_required'};
  if(!part||typeof part.text!=='string') return {text,complete:false,reason:'invalid_chunk'};
  if(part.continuation_token&&seen.has(part.continuation_token)) return {text,complete:false,reason:'repeated_token'};
  text+=part.text;
  if(part.usage) context_usage=part.usage;
  if(part.finish_reason==='STOP'&&!part.continuation_token) return {text,complete:true};
  if(!part.continuation_token||++hops>max_hops) return {text,complete:false,reason:'missing_token_or_hop_limit'};
  if(context_usage&&contextReserve(host,context_usage).checkpoint) return {text,complete:false,reason:'context_checkpoint_required',continuation_token:part.continuation_token};
  seen.add(part.continuation_token);
  const input={continuation_token:part.continuation_token};
  if(supports_previous_interaction_id&&previous_interaction_id) input.previous_interaction_id=previous_interaction_id;
  try {part=await request(input);} catch(error) {return {text,complete:false,reason:String(error.message),continuation_token:input.continuation_token};}
 }
}
