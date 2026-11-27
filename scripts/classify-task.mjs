#!/usr/bin/env node
import {scanMaterials} from './injection_scan.mjs';
import {protectedMaterials} from './protected-materials.mjs';
import { reasoningLanguage, ENGLISH_GUIDANCE } from './reasoning-language.mjs';
import { promoted } from './run-policy.mjs';
import {verifyHandoff} from './handoff-contract.mjs';
import { acceptWorker } from './worker-contract.mjs';
import { continueOutput, contextReserve } from './long-output.mjs';
import { resolveSessionModel } from './session-model.mjs';
/** Offline task classifier. Neon orchestration and Hydrogen worker routing are
 * unmeasured launch-post proposals; routing_status/routing_note expose that fact.
 * verified_path never claims Neon host mapping has been verified.
 */
import { isMainModule } from './is-main.mjs';
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function loadRouting() {
	return JSON.parse(
		fs.readFileSync(
			path.join(ROOT, "skills", "ulw", "references", "model-routing.json"),
			"utf8",
		),
	);
}

// Optional host JSON and piped prompts must never wait for EOF on an idle pipe.
async function readInput() {
 if (process.stdin.isTTY) return '';
 return new Promise(resolve => {
  let text = '';
  const input = process.stdin;
  const finish = () => {
   clearTimeout(idle); clearTimeout(deadline);
   input.pause();
   input.unref?.();
   input.removeListener('data', data); input.removeListener('end', finish); input.removeListener('error', finish);
   resolve(text.trim());
  };
  let idle = setTimeout(finish, 150);
  const deadline = setTimeout(finish, 1500);
  const data = chunk => {
   text += chunk;
   clearTimeout(idle); idle = setTimeout(finish, 150);
   if (process.argv[2]) { try { JSON.parse(text); finish(); } catch {} }
  };
  input.setEncoding('utf8');
  input.on('data', data); input.once('end', finish); input.once('error', finish);
 });
}

/**
 * Score each kind by keyword (weight 2) and pattern (weight 1) hits.
 * JSON key order determines priority when scores tie (first = highest priority).
 */
// ASCII signals match whole words only ("PR" must not hit "print"); Korean signals keep substring matching for particles.
function hasSignal(lower, signal) {
	const s = signal.toLowerCase();
	if (!/^[\x00-\x7f]+$/.test(s)) return lower.includes(s);
	const escaped = s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	return new RegExp(`(?<![a-z0-9])${escaped}(?![a-z0-9])`).test(lower);
}

function scoreKinds(prompt, taskKinds) {
	const lower = prompt.toLowerCase();
	const scores = {};
	for (const [kind, def] of Object.entries(taskKinds)) {
		let score = 0;
		for (const kw of def.signals.keywords) {
			if (hasSignal(lower, kw)) score += 2;
		}
		for (const pat of def.signals.patterns) {
			if (hasSignal(lower, pat)) score += 1;
		}
		scores[kind] = score;
	}
	return scores;
}

/**
 * Pick the highest-scoring kind; JSON key order breaks ties.
 * Kinds with override_on_match (security/PII) win whenever they match, so their audit rules are never dropped.
 */
function pickKind(scores, taskKinds) {
	let best = "general";
	let bestScore = 0;
	const overrides = Object.keys(taskKinds).filter((k) => taskKinds[k].override_on_match && (scores[k] ?? 0) > 0);
	for (const kind of overrides.length ? overrides : Object.keys(taskKinds)) {
		if ((scores[kind] ?? 0) > bestScore) {
			bestScore = scores[kind];
			best = kind;
		}
	}
	return { kind: best, score: bestScore };
}

/**
 * Classify size.
 * Priority:
 *   1. ≥3 explicit code-file paths in the prompt → subagents
 *   2. Korean quantity: "N개 모듈/파일/..." or "모듈/파일 N개", N≥3 → subagents
 *   3. Explicit numeric file count: "3 files", "3개 파일", "5 modules" → based on N
 *   4. size_signals from modes.subagents (JSON): "parallel", "전체 폴더", "모든 파일", etc. → subagents
 *   5. Default: single
 */
function classifySize(prompt, modes) {
	const lower = prompt.toLowerCase();

	// 1. Count explicit code-file paths (e.g. src/a.ts, utils/b.js, foo.py)
	const filePathRe =
		/\b[\w./%-][\w./%-]*\.(?:ts|tsx|js|jsx|mjs|cjs|py|go|rs|java|rb|cs|cpp|c|h|vue|svelte|kt|swift|sh|md|json|yaml|yml)\b/g;
	const filePaths = prompt.match(filePathRe) ?? [];
	if (filePaths.length >= 3) return "subagents";

	// 2. Korean quantity patterns
	//    "N개 모듈/파일/컴포넌트/..."  e.g. "6개 모듈", "3개 파일"
	//    "모듈/파일 N개"               e.g. "모듈 6개", "파일 5개"
	const unitKo = "모듈|파일|컴포넌트|함수|클래스|디렉토리|폴더|기능|서비스|api";
	const koAfterMatch = lower.match(new RegExp(`(\\d+)\\s*개\\s*(?:${unitKo})`, "u"));
	const koBeforeMatch = lower.match(new RegExp(`(?:${unitKo})\\s*(\\d+)\\s*개`, "u"));
	if (koAfterMatch && parseInt(koAfterMatch[1], 10) >= 3) return "subagents";
	if (koBeforeMatch && parseInt(koBeforeMatch[1], 10) >= 3) return "subagents";

	// 3. English/mixed explicit count: "3 files", "5 modules", "3개 파일"
	const numFileMatch = lower.match(/(\d+)\s*(?:(?:개\s*)?(?:files?|파일|modules?|components?))/);
	if (numFileMatch) {
		return parseInt(numFileMatch[1], 10) >= 3 ? "subagents" : "single";
	}

	// 4. Keyword signals from JSON (parallel, 독립적, 전체 폴더, 모든 파일, across the repo, …)
	const signals = modes?.subagents?.size_signals ?? [];
	for (const sig of signals) {
		if (lower.includes(sig.toLowerCase())) return "subagents";
	}

	return "single";
}

/** Neon tier mapping is proposed, not runtime-verified. Neon is the only orchestrator family. */
function verifiedPath(model) {
	if (modelFamily(model) === "gemini-4-neon") return "unverified-neon";
	return "unverified-nested";
}

/** Model id without its thinking-level suffix: "gemini-4-neon-high" → "gemini-4-neon". */
export function modelFamily(model) {
	return (model ?? "").replace(/-(low|medium|high|xhigh)$/, "");
}

const LEVELS = ["low", "medium", "high", "xhigh"];
export function thinkingTier(model) {
	return LEVELS.indexOf((model ?? "").match(/-(low|medium|high|xhigh)$/)?.[1]);
}
export const GATE_ROLES = Object.freeze(["plan", "final_review", "security_audit", "forensic_verdict", "pii_inject_docfmt", "verdict_review"]);
export function isGate(roles, roleName) {
	return GATE_ROLES.includes(roleName) || Boolean(roles[roleName]?.never?.length);
}
// No subagent tier reaches Neon on this host (`pro` runs Hydrogen XHigh, antigravity-cli #1824/#1710), so a Neon-only
// step in a non-Neon session can only be fixed by the user switching the session model.
export const SWITCH_TO_NEON = "switch the model picker to Gemini 4 Neon (모델 선택기에서 Gemini 4 Neon 선택, Orchestrator 아님)";
export function getAction(model, roles, roleName, mode, subagentTiers = {}, sessionModel = null) {
 const actual = sessionModel ?? "unknown";
 const required = roles[roleName]?.model ?? model;
 const suffix = ruleSuffix(roles, roleName);
 // Unknown host reports never block ordinary work; never call scheduling a PASS.
 if (actual === 'unknown' || modelFamily(actual) === 'gemini-4-neon') {
  if (mode === 'subagents' && !isGate(roles, roleName) && roleName !== 'long_context') {
   const target = roles.parallel_workers.model;
   const tier = Object.entries(subagentTiers).find(([,family]) => family === modelFamily(target))?.[0];
   if (tier) return `delegate via invoke_subagent Model: "${tier}" (${modelFamily(target)} fan-out)${suffix}`;
  }
  return `proceed in session${suffix}`;
 }
 const neon = modelFamily(required) === 'gemini-4-neon' ? required : roles.default.model;
 const available = Object.values(subagentTiers).includes(modelFamily(neon));
 return (available ? `delegate: invoke_subagent ${neon}` : `refuse: needs ${neon}; ${SWITCH_TO_NEON}`) + suffix;
}

/** Protected work never leaves the session: no subagent fan-out, no `pro` delegation, no Orchestrator. */
export function sensitiveAction(roles, roleName, sessionModel = null) {
 const suffix = ruleSuffix(roles, roleName);
 const actual = sessionModel ?? "unknown";
 if (actual !== "unknown" && (modelFamily(actual) !== "gemini-4-neon" || /orchestrator/i.test(actual)))
  return `refuse: sensitive task needs a direct Gemini 4 Neon session (no subagents, no Orchestrator); ${SWITCH_TO_NEON}${suffix}`;
 return `proceed in session${suffix}`;
}

/** Execute a gate through a host-supplied runner. No automatic duplicate calls.
 * The runner must report the actual model and evidence, not just a successful launch.
 */
export async function executeGate(roles, roleName, run, options = {}) {
 const role = roles[roleName];
 const attempts = [];
 const refused = () => ({ status: "refused", attempts });
 if (typeof run !== "function") return { status: "refused", reason: "host_adapter_required", attempts };
 if (!isGate(roles, roleName) || !/^gemini-4-neon-(high|xhigh)$/.test(role?.model)) return refused();
 if(options.context_usage&&contextReserve(options.host??{},options.context_usage).checkpoint)
  return {status:'refused',reason:'context_checkpoint_required',attempts};
 if(options.policy) {
  const {usageGuard}=await import('./usage_guard.mjs');
  const decision=usageGuard(options.policy);
  if(decision.blocked) return {status:'refused',reason:decision.reason,checkpoint:decision.checkpoint,attempts};
 }
 if(options.worker_report) {
  try {
   const acceptance=acceptWorker(options.worker_report,{cwd:options.cwd,receipts:options.receipts});
   if(acceptance.acceptance!=='reviewed') return {status:'refused',reason:'worker_not_accepted',acceptance,attempts};
  } catch(error) {return {status:'refused',reason:error.message,attempts};}
 }
 if(options.handoff) {
  try {
   const verified=verifyHandoff(options.handoff,options.cwd??process.cwd());
   if(verified.status!=='verified') return {status:'refused',reason:'handoff_reverify',handoff:verified,attempts};
   options={...options,previous_interaction_id:options.handoff.previous_interaction_id};
  } catch(error) {return {status:'refused',reason:'handoff_reverify',attempts};}
 }
 let materials;
 try {materials=scanMaterials(options.materials??[]);} catch(error) {return {status:'refused',reason:'invalid_gate_materials',attempts};}
 const models = [promoted(options.promotion,{cwd:options.cwd,gate:roleName,receipts:options.receipts}) ? "gemini-4-neon-xhigh" : "gemini-4-neon-high"];
 // Latency/unavailability does not justify an automatic duplicate call.
 for (const model of models) {
  let result;
  try { result = await run(model, { role: roleName, prompt: role.prompt, materials, ...(options.supports_previous_interaction_id&&options.previous_interaction_id?{previous_interaction_id:options.previous_interaction_id}:{}) }); }
  catch (error) { result = { status: "unavailable", error: String(error.message ?? error) }; }
  if (result?.continuation_token || result?.finish_reason === "CONTINUATION") {
   if (typeof options.continue !== "function") return {status:"refused",reason:"continuation_adapter_required",attempts};
   const decoded = await continueOutput(result, options.continue, options);
   if (!decoded.complete) return {status:"refused",reason:decoded.reason,attempts};
   try {result = typeof options.parseCompleted === "function" ? options.parseCompleted(decoded.text) : null;}
   catch {return {status:'refused',reason:'invalid_completed_verdict',attempts};}
  }
  attempts.push({ model, result });
  if(result?.finish_reason&&result.finish_reason!=='STOP') return refused();
  if (result?.status === "unavailable") continue;
  if (result?.model === model && result.status === "passed" && Array.isArray(result.evidence) && result.evidence.length > 0) {
   return { status: "passed", attempts, verdict: result };
  }
  return refused();
 }
 return refused();
}

/**
 * Verdict rule version a role's routing entry requires ("v3", "v2", …), read from the leading `vN` of its
 * `prompt` field (data-driven, not by kind name); null when the role needs no flag/fail rule.
 */
export function verdictRuleVersion(roles, roleName) {
	const prompt = roles[roleName]?.prompt;
	return typeof prompt === "string" ? (/^(v\d+)\b/.exec(prompt)?.[1] ?? null) : null;
}

function ruleSuffix(roles, roleName) {
	const version = verdictRuleVersion(roles, roleName);
	return version ? `, apply ${version} flag/fail rule` : "";
}

/**
 * One-line session notice when the ideal model differs from the session default.
 * /ulw cannot change the session model mid-flight.
 */
export function sessionNotice(model, roles, sessionModel = null) {
	const actual = sessionModel ?? "unknown";
	if (modelFamily(actual) === 'gemini-4-neon' && thinkingTier(actual) === 2 && thinkingTier(model) === 3) return 'xhigh 권장, high로 진행';
 if (thinkingTier(actual) < 0 || thinkingTier(model) < 0) return `[미확인] thinking level: session=${actual ?? "unknown"}, required=${model}`;
	if (modelFamily(actual) !== modelFamily(model) || thinkingTier(actual) < thinkingTier(model)) return `세션 ${actual}; 필요 ${model} — 요구 모델/사고 수준 미달`;
	if (thinkingTier(actual) > thinkingTier(model)) return `세션 ${actual}; 권장 ${model} — 필요 이상의 사고 수준: 비용 증가 [미측정]`;
	return null;
}

function buildReason(kind, taskKinds, prompt, size) {
	if (kind === "general") {
		return `No keyword match found; applying default role. Size: ${size}.`;
	}
	const def = taskKinds[kind];
	const lower = prompt.toLowerCase();
	const hit = def.signals.keywords.filter((k) => hasSignal(lower, k));
	const kw = hit.length ? hit.join(", ") : "(pattern match)";
	return `Kind: ${kind}. Keywords matched: ${kw}. Role: ${def.role}. Size: ${size}.`;
}

// ── main ────────────────────────────────────────────────────────────────────

export function classifyTask(prompt, hostPayload = {}) {
	const routing = loadRouting();
	const { task_kinds, roles, modes } = routing;
 for (const name of GATE_ROLES) if (promoted(hostPayload.promotion,{cwd:hostPayload.cwd,gate:name})) {
  roles[name].model="gemini-4-neon-xhigh"; roles[name].recommended_level="xhigh";
 }

	if (!task_kinds) {
		console.error(
			"model-routing.json is missing the task_kinds section. Add it before using this classifier.",
		);
		process.exit(1);
	}


	const scores = scoreKinds(prompt, task_kinds);
 const mechanicalCheck = /매니페스트|manifest|해시|hash/i.test(prompt) && /검증|대조|맞는지|verify|check/i.test(prompt)
  && !['forensic_verdict','sensitive','security_audit','plan','final_review'].some(k => scores[k] > 0)
  && !/위변조|진위|authentic|forensic|판단/i.test(prompt);
 if (mechanicalCheck) {
  for (const k of Object.keys(scores)) if (isGate(roles, task_kinds[k].role)) scores[k] = 0;
  scores.count_extract = Math.max(...Object.values(scores)) + 1;
 }
	let { kind } = pickKind(scores, task_kinds);
	// Mechanical hash collection is not an authenticity verdict or generic implementation.
	if (scores.count_extract > 0 && !Object.keys(task_kinds).some(k => scores[k] > 0 && isGate(roles, task_kinds[k].role))) kind = 'count_extract';
 const hydrogenExcluded=protectedMaterials(prompt,hostPayload,Object.keys(scores).filter(k=>scores[k]>0));
 if(hydrogenExcluded) {
  for(const role of Object.values(roles)) {
   for(const field of ['model','fallback']) if(modelFamily(role[field])==='gemini-4-hydrogen') {
    role[field]='gemini-4-neon-high';
    role.note='[미측정] Protected materials: Neon workers; Hydrogen family excluded.';
   }
  }
 }
 const tokenCounts=[...prompt.matchAll(/(\d[\d,_]*(?:\.\d+)?)\s*([kKmM]?)\s*(?:tokens?\b|토큰)/gi)].map(m=>Number(m[1].replace(/[,_]/g,''))*({k:1000,m:1000000}[m[2].toLowerCase()]??1));
 const shorthand=/\b(?:2[5-9]\d|[3-9]\d{2}|\d{4,})k(?![\p{L}\p{N}_])/iu.test(prompt);
 const longContext=(scores.long_context??0)>0||tokenCounts.some(n=>n>=250000)||shorthand;
 const reading=kind==='general'&&/요약|설명|읽기|summari[sz]e|explain|\bread\b/i.test(prompt);
 const docTypo=/오타|typo/i.test(prompt)&&/\.md\b/i.test(prompt)&&!/[4-9]\s*개|\d{2,}\s*(?:개|files)/i.test(prompt)&&([...prompt.matchAll(/\.md\b/gi)].length<=3);
 const size=longContext||reading||docTypo?'single':classifySize(prompt,modes);
	const mode = size === "subagents" && !hydrogenExcluded ? "subagents" : "single";

	const kindDef = task_kinds[kind];
	const roleName = longContext && !isGate(roles, kindDef?.role) ? "long_context" : kindDef ? kindDef.role : "default";
	const roleData = roles[roleName] ?? roles.default;
	const model = roleData.model;

	const vpath = verifiedPath(model);
 const resolvedModel = resolveSessionModel(hostPayload);
	const sessionModel = resolvedModel === "unknown" ? null : resolvedModel;
 // Protected materials: every step stays in this session (sensitiveAction); otherwise the routing table decides.
 const act = (m, role, stepMode) => hydrogenExcluded ? sensitiveAction(roles, role, sessionModel) : getAction(m, roles, role, stepMode, routing.subagent_tiers, sessionModel);
	let action = act(model, roleName, mode);
	const gateRoles = [...new Set(Object.keys(task_kinds).filter(k => scores[k] > 0 && isGate(roles, task_kinds[k].role)).map(k => task_kinds[k].role))];
	const gateSteps = gateRoles.map(role => ({ role, model: roles[role].model, action: act(roles[role].model, role, "single") }));
	const unverifiedSensitive = hydrogenExcluded && !sessionModel ? "[미확인] 세션 모델 미보고: 민감 작업은 Orchestrator가 아닌 Gemini 4 Neon 단독 세션에서만 한다" : null;
	const notice = [...new Set([model, ...gateSteps.map(s => s.model)].map(m => sessionNotice(m === model ? `gemini-4-neon-${roleData.recommended_level}` : m, roles, sessionModel)).concat(unverifiedSensitive).filter(Boolean))].join("; ") || null;
	const workerModel = mode === "subagents" ? (isGate(roles, roleName) ? model : roles.parallel_workers.model) : null;
	const executionRoles = [...new Set(Object.keys(task_kinds).filter(k => scores[k] > 0 && ["implementation", "long_execution", "script_first", "mechanical"].includes(task_kinds[k].role)).map(k => task_kinds[k].role))];
	const steps = gateSteps.length ? [
		...gateSteps.filter(step => step.role === "plan"),
		...executionRoles.map(role => ({ role, model: longContext ? roles.long_context.model : mode === "subagents" ? roles.parallel_workers.model : roles[role].model, action: act(longContext ? roles.long_context.model : roles[role].model, longContext ? "long_context" : role, mode) })),
		...gateSteps.filter(step => step.role !== "plan"),
	] : [{ role: roleName, model: workerModel ?? model, action }];
 // Hydrogen reports are claims: insert a Neon evidence check before any adoption/final gate.
 for (let i = steps.length - 1; i >= 0; i--) {
  if (modelFamily(steps[i].model) !== 'gemini-4-hydrogen') continue;
  steps.splice(i + 1, 0, { role: 'worker_verification', model: roles.final_review.model,
   status: 'pending', evidence_required: true,
   action: act(roles.final_review.model, 'final_review', 'single') + '; Neon must check each worker claim against original files, diffs and execution receipts before adoption; reject unsupported claims; run scripts/worker-contract.mjs report.json parent-receipts.json; adopt only independently reproduced defects' });
 }
 const documentInput = /\.(docx|xlsx|pptx|odt|ods|odp)\b/i.test(prompt)
  ? { model: 'gemini-4-neon-high', mode: 'direct_if_supported', fallback: 'conversion', evidence: ['sheet/cell','paragraph/slide','source_path'], exact_values: 'parser_cross_check' } : null;
 if (documentInput) steps.unshift({ role: 'document_input', model: documentInput.model,
  action: act(documentInput.model, 'default', 'single')
   + '; use original Office/ODF input directly when host supports it; conversion only as fallback' });
 // Classification schedules work; pending is never a passed review.
	const gateResults = [];
	for (const step of steps) {
		if (!isGate(roles, step.role) && step.role !== 'worker_verification') continue;
  if (step.action.startsWith('proceed')) {
   gateResults.push({role:step.role, status:'pending', execution:'in_session', model:sessionModel ?? 'unknown', required_model:step.model, evidence_required:true, attempts:[]});
  } else if (step.action.startsWith('delegate')) {
   gateResults.push({role:step.role, status:'pending', execution:'delegation_required', model:step.model, evidence_required:true, attempts:[]});
  } else {
   gateResults.push({role:step.role, status:'refused', reason:hydrogenExcluded ? 'sensitive_requires_neon_session' : step.action.includes(SWITCH_TO_NEON) ? 'neon_session_required' : 'host_adapter_required', attempts:[]});
  }
	}
	const refused = steps.find(step => (isGate(roles, step.role) || step.role === 'worker_verification') && step.action.startsWith('refuse:'));
	if (refused) action = refused.action + ruleSuffix(roles, roleName);
	else if (isGate(roles, roleName)) action = steps.find(step => step.role === roleName).action;

	const reason = buildReason(kind, task_kinds, prompt, size);
	const promptField = verdictRuleVersion(roles, roleName);

	// Rules of every matched kind apply (a prompt can be both a count and a forensic verdict), then the common rule.
	const matchedRules = Object.keys(task_kinds)
		.filter((k) => (scores[k] ?? 0) > 0)
		.sort((a, b) => scores[b] - scores[a])
		.map((k) => roles[task_kinds[k].role]?.rule)
		.filter(Boolean);
	const rules = [...new Set([...matchedRules, hydrogenExcluded ? routing.protected_materials?.delegation_rule : null, routing.common_rule].filter(Boolean))];
 const reasoning_language = hydrogenExcluded ? 'ko' : reasoningLanguage(prompt, kind, Object.keys(task_kinds).filter(k => scores[k] > 0));
 if (reasoning_language === 'en') rules.push(ENGLISH_GUIDANCE);
	const sttModel = Object.keys(task_kinds)
		.filter((k) => (scores[k] ?? 0) > 0)
		.map((k) => roles[task_kinds[k].role]?.stt_model)
		.find(Boolean) ?? null;

	return {
                reasoning_language,
                hydrogen_excluded: hydrogenExcluded,
                delegation: hydrogenExcluded ? "forbidden" : "allowed",
                recommended_level: roleData.recommended_level,
                usage: estimateUsage(longContext ? "long_context" : size, roleData.recommended_level, prompt),
                document_input: documentInput,
                context_policy: longContext ? roles.long_context.context_policy : null,
				session_model: sessionModel ?? "unknown",
				gate_results: gateResults,
				kind,
				size,
				model,
				mode,
				reason,
				routing_note: roleData.note,
				routing_status: routing.status,
				worker_model: workerModel,
				gate_execution: gateResults.length ? (refused ? (refused.action.includes(SWITCH_TO_NEON) ? "neon_session_required" : "host_adapter_required") : gateResults.some(g => g.execution === "delegation_required") ? "delegation_required" : "in_session") : null,
				steps,
				fallback: roleData.fallback ?? null,
				timeout_sec: roleData.timeout_sec ?? null,
				min_context_tokens: longContext ? roles.long_context.min_context_tokens : roleData.min_context_tokens ?? null,
				verified_path: vpath,
				action,
				session_notice: notice,
				prompt: promptField,
				rules,
				stt_model: sttModel,
 };
}

export function estimateUsage(size, level, prompt="") {
 const media=/녹음|전사|transcrib|audio|video|\.(?:wav|mp3|mp4|m4a|mov)\b/i.test(prompt);
 const duration=[...prompt.matchAll(/(\d+(?:\.\d+)?)\s*(hours?|시간|minutes?|분)/gi)].some(m=>Number(m[1])*(/hours?|시간/i.test(m[2])?60:1)>=60);
 const bulk=/\d+\s*만\s*개|(?:\d{4,}|\d{1,3}(?:,\d{3})+)\s*(?:개|files|records|rows)/i.test(prompt);
 const weight = size === 'long_context' ? 4 : size === 'subagents'||bulk||(media&&duration) ? 3 : media||/\.(?:pdf|docx|xlsx|pptx|odt|ods|odp)\b/i.test(prompt)?2:1;
 const score = weight * ({ low: 1, medium: 1, high: 2, xhigh: 3 }[level] ?? 2);
 const usageClass = score >= 3 ? 'heavy' : score === 2 ? 'medium' : 'light';
 return { class: usageClass, blocked: false, note: '[미측정] size × level heuristic, not billing/quota measurement',
  warning: usageClass === 'heavy' ? 'heavy 사용량 예상 [미측정]; 추정만으로 차단하지 않는다; usage_guard checkpoints and warns; only gates may refuse' : null };
}
async function main() {
 const input = await readInput();
 const prompt = process.argv[2] ? process.argv.slice(2).join(' ') : input;
 if (!prompt) { console.error('Usage: node scripts/classify-task.mjs "<task description>"'); process.exitCode = 1; return; }
 let payload = {};
 if (process.argv[2]) { try { payload = JSON.parse(input); } catch {} }
 process.stdout.write(JSON.stringify(classifyTask(prompt, payload), null, 2) + '\n');
}
if (isMainModule(import.meta.url)) main();
