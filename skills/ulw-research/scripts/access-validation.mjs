// Signal-only adaptation of insane-search 8221189 validators and WAF detectors.
// No target-site branches; a WAF header alone is not proof of a blocked page.
export function validateResponse(status, text, headers = {}) {
 const h = new Headers(headers);
 const signals = [];
 for (const [name,value] of h) if (/cf-ray|x-akamai|x-kpsdk|x-iinfo|x-amzn-waf/i.test(name) || (name==='server' && /cloudflare|akamaighost/i.test(value))) signals.push('waf_header');
 const cookie=h.get('set-cookie') || '';
 if (/_abck=.*~-1~/.test(cookie)) signals.push('unresolved_sensor');
 const result=outcome=>({outcome,signals,httpStatus:status});
 if ([401,402,407].includes(status)) return result('auth_required');
 if ([404,410].includes(status)) return result('not_found');
 if (status===429) return result('rate_limited');
 if (status<200 || status>=300) return result('blocked');
 if (/sec-if-cpt-container|cf-chl|window\._cf_chl_opt|orchestrate\/chl_page|just a moment|px-captcha|cf-turnstile|requested URL was rejected|Request unsuccessful\. Incapsula|verify you are human|checking your browser/i.test(text)) return result('challenge');
 const visible=text.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi,' ').replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').trim();
 if (/sign in to continue|log in to (continue|view)|login required|subscribe to (read|continue)|로그인.{0,12}(필요|해주세요)|구독하세요/i.test(visible) || /<input\b[^>]*type\s*=\s*["']?password/i.test(text)) return result('auth_required');
 if (/^(404\b|page not found|not found\b|페이지를 찾을 수 없)/i.test(visible)) return result('not_found');
 if (/json/i.test(h.get('content-type')||'')) {
  try {const data=JSON.parse(text);if (!data || data.error || (Array.isArray(data)&&!data.length) || (typeof data==='object'&&!Object.keys(data).length)) return result('invalid_content');return result('ok');} catch {return result('invalid_content');}
 }
 if (visible.length<200 && /captcha|access denied|datadome/i.test(visible)) return result('challenge');
 if (signals.includes('unresolved_sensor')) return result('challenge');
 if (/<(?:rss|feed)\b/i.test(text) && /<(?:item|entry)\b/i.test(text)) return result('ok');
 return result(visible.length<100?'empty_content':'ok');
}
