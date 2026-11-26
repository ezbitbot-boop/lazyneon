#!/usr/bin/env node
import {pluginProvenance} from './provenance.mjs';
/**
 * stop_claim_guard.mjs — Stop/SubagentStop 자기완료 선언 게이트
 * Generic guard owned by LazyNeon core.
 *
 * 임무: 모델의 최종 메시지가 "완료/전수/100%/무결점/모두 통과" 류의 완료 선언을 하면서
 * 반증 가능한 증거(실행 명령, 테스트 수, 산출물 경로, 커밋 SHA)를 제시하지 않으면
 * stop 을 막고(Antigravity Stop 규격 decision "continue") 증거 첨부를 요구한다. "검증 완료" 보고가 사실과 다르던 사례
 * (순환 감사 "100% PASS", 문서화만 된 --plot-fft, 라우팅 미등록)의 재발 방지.
 *
 * 페이로드 규약 (start-work-continuation codex-hook.js 와 동일):
 *   { hook_event_name: "Stop"|"SubagentStop", stop_hook_active: bool,
 *     last_assistant_message?: string, ... }
 * 차단 규약: stdout 에 {"decision":"continue","reason":"..."} 출력 + exit 0 (Antigravity Stop 계약: continue 만 루프 재진입, 그 외 값은 정지 허용).
 * 자기 점검(LAZYNEON_SELF_CHECK 또는 config/local.json "selfCheck")은 기본 on이며 위험 주장에 재확인을 요청해 Stop을 막을 수 있다.
 * 완료 근거 검사 모드: 기본은 observe — 차단했을 판정을 <workspace>/.lazyneon/stop-guard.jsonl 에 기록만 하고 통과시킨다.
 *   LAZYNEON_STOP_GUARD=enforce (대소문자·양끝 공백 무시) 일 때 완료 근거 검사도 Stop을 막는다.
 *   기록에는 답변 원문을 남기지 않는다: 답변과 점검 문장은 sha256 해시와 길이만 적는다(사건 내용이 기록 파일에 남지 않게).
 *   페이로드에 절대경로 워크스페이스가 없으면 아무 데도 기록하지 않는다(홈 폴더로 대신 쓰지 않는다).
 *
 * 정직한 동작 규약:
 * - stop_hook_active=true (이미 재개된 턴)면 개입하지 않는다 — 무한 루프 방지.
 * - 최종 메시지를 못 읽거나 파싱에 실패하면 개입하지 않는다 (exit 0).
 * - 증거가 있는 선언은 통과시킨다. 이 가드는 완료 자체가 아니라 무근거 완료 선언만 막는다.
 */
const GUARD_PACK_VERSION = '1.1.0';

const CLAIM_RE = new RegExp(
	[
		'완료', '완성', '테스트\\s*통과', '전부\\s*반영', '작업\\s*끝', '(?:문제|이상|오류)\\s*없', '빠짐없이\\s*확인', '다\\s*(했|끝냈)', '전부\\s*(했|완료|수정|추가)', '전수', '무결점', '완벽',
		'100\\s*%', '모두\\s*(통과|반영|수정|추가|검증)', '검증\\s*(완료|끝|했)', '통과\\s*(했습니다|했다)',
		'all\\s*(tests?\\s*)?(pass|passed|done|complete|finished)', 'fully\\s*(verified|tested|implemented|reviewed)',
		'100%\\s*(pass|coverage|complete)', 'complete\\s*and\\s*verified', 'zero\\s*(issues|failures)',
	].join('|'),
	'i',
);

const FILE_EVIDENCE_RE = /[\w./가-힣-]+\.(?:md|json|png|txt|html|csv|yml|yaml|ts|js|mjs|py|go|rs|pdf|docx?|hwpx?|xlsx?|eml|pst|zip|7z|e01|raw)\b/g;

import { hookTargets } from './hook_targets.mjs';
import { resolveWorkspace } from './workspace-path.mjs';
import { settings } from './settings.mjs';
import { isMainModule } from './is-main.mjs';
import { readStdin } from './read-stdin.mjs';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// 도구 하나가 실패하고 바로 답하며 끝난 턴은 PostToolUse 시점에 그 출력이 transcript 에 없어 조회 실패가
// 기록되지 않았다(Windows 실기 2026-11-03). 턴이 끝난 이 시점에 lookup_guard 를 한 번 더 돌린다.
// Stop 훅은 LazyNeon hooks.json 한 곳에만 둔다는 규칙 때문에 별도 Stop 항목 대신 여기서 부른다.
// 기록만 한다: 답이 이미 나간 뒤라 경고를 대기열에 넣으면 다음의 무관한 질문에 끼어든다(실기 d5bd6dcb).
function recordFailedLookups(raw) {
	const here = path.dirname(fileURLToPath(import.meta.url));
	const guard = path.join(here, 'lookup_guard.mjs');
	if (!fs.existsSync(guard)) return;
	const result = spawnSync(process.execPath, [guard], { input: raw, encoding: 'utf8', timeout: 4000 });
	if (result.stderr) process.stderr.write(result.stderr);
}

function resolveTranscriptPaths(payload) {
	if (!payload || typeof payload !== 'object') return [];
	const candidates = [];
	const add = (p) => {
		if (typeof p === 'string' && p.trim() && !candidates.includes(p.trim())) {
			candidates.push(p.trim());
		}
	};
	const tp = payload.transcriptPath || payload.transcript_path || '';
	if (typeof tp === 'string' && tp.trim()) {
		if (/transcript\.jsonl$/i.test(tp) && !/transcript_full\.jsonl$/i.test(tp)) {
			add(tp.replace(/transcript\.jsonl$/i, 'transcript_full.jsonl'));
			add(tp);
		} else if (/transcript_full\.jsonl$/i.test(tp)) {
			add(tp);
			add(tp.replace(/transcript_full\.jsonl$/i, 'transcript.jsonl'));
		} else {
			add(tp);
		}
	}
	const adp = payload.artifactDirectoryPath || payload.artifact_directory_path || '';
	if (typeof adp === 'string' && adp.trim()) {
		add(path.join(adp, '.system_generated', 'logs', 'transcript_full.jsonl'));
		add(path.join(adp, '.system_generated', 'logs', 'transcript.jsonl'));
		add(path.join(adp, 'transcript_full.jsonl'));
		add(path.join(adp, 'transcript.jsonl'));
	}
	return candidates.filter((p) => {
		try {
			return fs.existsSync(p) && fs.statSync(p).isFile();
		} catch {
			return false;
		}
	});
}

function unquoteVal(val) {
	if (typeof val !== 'string') return '';
	const t = val.trim();
	if (t.length >= 2 && t.startsWith('"') && t.endsWith('"')) {
		try {
			const parsed = JSON.parse(t);
			if (typeof parsed === 'string') return parsed;
		} catch {
			return t.slice(1, -1);
		}
	}
	return val;
}

function extractSendMessageTexts(step) {
	const calls = Array.isArray(step?.tool_calls)
		? step.tool_calls
		: Array.isArray(step?.toolCalls)
			? step.toolCalls
			: step?.toolCall && typeof step.toolCall === 'object'
				? [step.toolCall]
				: [];
	const msgs = [];
	for (const tc of calls) {
		if (!tc || typeof tc !== 'object') continue;
		const name = unquoteVal(String(tc.name || tc.tool_name || tc.toolName || tc.function?.name || ''));
		if (!/^send_message$/i.test(name)) continue;
		let args = tc.args ?? tc.arguments ?? tc.input ?? tc.parameters ?? tc.function?.arguments;
		if (typeof args === 'string') {
			try {
				args = JSON.parse(unquoteVal(args));
			} catch {
				try { args = JSON.parse(args); } catch { args = null; }
			}
		}
		if (args && typeof args === 'object') {
			const msg = args.Message ?? args.message ?? args.content ?? '';
			if (typeof msg === 'string' && msg.trim()) msgs.push(unquoteVal(msg));
		}
	}
	return msgs;
}

const CLOSING_ACK_RE = /(?:전달|보고|전송|회신)(?:했|드렸|하였|완료)|(?:전달|보고)했습니다/;

export function extractLastAssistantMessageFromTranscript(transcriptContent) {
	if (!transcriptContent) return '';
	const lines = transcriptContent.split(/\r?\n/).filter((l) => l.trim().length > 0).slice(-30).reverse();
	const modelSteps = [];
	for (const line of lines) {
		try {
			const step = JSON.parse(line);
			if (!step || typeof step !== 'object' || step.type === 'GENERIC') continue;
			if (step.type === 'PLANNER_RESPONSE' || step.source === 'MODEL') modelSteps.push(step);
		} catch {
			// ignore malformed line
		}
	}
	if (!modelSteps.length) return '';
	const latest = modelSteps[0];
	const content0 = typeof latest.content === 'string' ? latest.content.trim() : '';
	const send0 = extractSendMessageTexts(latest);
	if (send0.length > 0) return [content0, ...send0].filter(Boolean).join('\n');
	const prevSend = modelSteps[1] ? extractSendMessageTexts(modelSteps[1]) : [];
	if (prevSend.length > 0) {
		const sent1 = prevSend.join('\n');
		if (!content0) return sent1;
		const nonEmptyLines = content0.split(/\r?\n/).filter((l) => l.trim().length > 0);
		if (nonEmptyLines.length <= 2 && CLOSING_ACK_RE.test(content0)) {
			return `${content0}\n${sent1}`;
		}
	}
	for (const step of modelSteps) {
		const c = typeof step.content === 'string' ? step.content.trim() : '';
		const sm = extractSendMessageTexts(step);
		if (c || sm.length) return [c, ...sm].filter(Boolean).join('\n');
	}
	return '';
}

const TAIL_FALLBACK_BYTES = 512 * 1024;

function readTailContent(filePath, maxBytes = 32 * 1024) {
	const stat = fs.statSync(filePath);
	if (stat.size <= maxBytes) {
		return fs.readFileSync(filePath, 'utf8');
	}
	const fd = fs.openSync(filePath, 'r');
	let complete = true;
	let text = '';
	try {
		const buf = Buffer.allocUnsafe(maxBytes);
		fs.readSync(fd, buf, 0, maxBytes, stat.size - maxBytes);
		const nlIdx = buf.indexOf(0x0a);
		complete = nlIdx >= 0 && nlIdx < maxBytes - 1;
		text = (nlIdx >= 0 ? buf.subarray(nlIdx + 1) : buf).toString('utf8');
	} finally {
		fs.closeSync(fd);
	}
	const hasModelStep = text.split(/\r?\n/).some((l) => {
		const t = l.trim();
		if (!t.startsWith('{')) return false;
		try {
			const s = JSON.parse(t);
			return Boolean(s && (s.type === 'PLANNER_RESPONSE' || s.source === 'MODEL'));
		} catch {
			return false;
		}
	});
	if ((!complete || !hasModelStep) && maxBytes < TAIL_FALLBACK_BYTES) {
		return readTailContent(filePath, TAIL_FALLBACK_BYTES);
	}
	return text;
}

/** Completion receipts must belong to a successful call after the latest user boundary.
 * Missing boundaries, timestamps, or call/result linkage fail closed. Read receipts
 * support explicitly read-only review claims, never creation or modification claims.
 */
export function completionEvidence(message, content, cwd) {
 const steps = content.split('\n').flatMap(line => { try { return [JSON.parse(line)]; } catch { return []; } });
 const start = steps.findLastIndex(s => s.type === 'USER_INPUT');
 if (start < 0) return false;
 const turnStart = Date.parse(steps[start].timestamp ?? steps[start].created_at);
 const pending = new Map();
 const files = new Set();
 const commits = new Set();
 const outputs = [];
 const reads = new Set();
 const readCommands = new Set();
 const review = /검토|리뷰|분석|확인|review|inspection|analysis/i.test(message)
  && !/생성|작성|수정|추가|반영|구현|테스트|created|written|modified|implemented|tests?\b/i.test(message);
 for (const step of steps.slice(start + 1)) {
  for (const call of step.tool_calls ?? step.toolCalls ?? []) {
   const id = call.id ?? call.tool_call_id;
   if (id) pending.set(id, { call, timestamp: Date.parse(step.timestamp ?? step.created_at) });
  }
  if (step.type !== 'GENERIC') continue;
  const id = step.tool_call_id ?? step.toolCallId;
  const receipt = pending.get(id);
  if (!receipt) continue;
  pending.delete(id);
  if (!/^(DONE|SUCCESS|COMPLETED)$/i.test(step.status ?? '') || step.error || (step.exit_code !== undefined && step.exit_code !== 0)) continue;
  const output = String(step.content ?? '');

  const { call, timestamp } = receipt;
  if (!Number.isFinite(turnStart) || !Number.isFinite(timestamp) || timestamp < turnStart) continue;
  const name = call.name ?? call.function?.name ?? '';
  // Worker prose is not an execution receipt, even when the delegation succeeded.
  if (/subagent|worker|delegate|agent.*(?:result|task)|task.*agent/i.test(name)) continue;
  outputs.push(output);
  let args = call.args ?? call.arguments ?? call.function?.arguments ?? {};
  if (typeof args === 'string') { try { args = JSON.parse(args); } catch { args = { patch: args }; } }
  const command = args.CommandLine ?? args.command ?? args.cmd ?? '';
  // Explicit read tools cite their actual input path; shell reads cite the exact
  // successful command. Restrict shell syntax instead of guessing side effects.
  if (review && output.trim()) {
   if (/^(?:read_file|read_document|view_file|Read|ReadFile|mcp__\w+__(?:read_file|read_document))$/.test(name)) {
    for (const key of ['path','Path','file_path','TargetFile','AbsolutePath','file']) {
     if (typeof args[key] !== 'string') continue;
     const file = path.resolve(cwd, args[key]);
     try { if (fs.statSync(file).isFile()) reads.add(file); } catch {}
    }
   }
   if (/^(?:run_command|exec_command|bash|shell)$/.test(name)
    && /^(?:cat|head|tail|rg|grep|wc|sha256sum|shasum)\s/.test(command)
    && !/[;&|<>`$\n\r]/.test(command) && !/--pre(?:=|\s)/.test(command)) readCommands.add(command);
  }
  const writes = /(?:write|edit|patch|create|fill|replace)/i.test(name) || (/run_command|exec_command|bash|shell/i.test(name) && /(?:>|\btee\s)/.test(command));
  if (writes) for (const file of hookTargets([{ parsed: { cwd, toolCall: { name, args } } }])) {
   try { const stat = fs.statSync(file); if (stat.isFile() && stat.mtimeMs >= timestamp && stat.mtimeMs <= Date.now()) files.add(file); } catch {}
  }
  if (/run_command|exec_command|bash|shell/i.test(name) && /\bgit\s+commit(?:\s|$)/.test(command)) {
   for (const match of output.matchAll(/\b[0-9a-f]{7,40}\b/gi)) {
    const result = spawnSync('git', ['-C', cwd, 'show', '-s', '--format=%H %ct', `${match[0]}^{commit}`], { encoding: 'utf8' });
    const [sha, seconds] = (result.stdout ?? '').trim().split(' ');
    if (result.status === 0 && Number(seconds) * 1000 >= Math.floor(timestamp / 1000) * 1000) commits.add(sha);
   }
  }
 }
 if ((message.match(FILE_EVIDENCE_RE) ?? []).some(file => (files.has(path.resolve(cwd, file)) || reads.has(path.resolve(cwd, file))))) return true;
 if ([...readCommands].some(command => message.includes('`' + command + '`'))) return true;
 if ([...message.matchAll(/\b[0-9a-f]{7,40}\b/gi)].some(m => [...commits].some(sha => sha.startsWith(m[0])))) return true;
 const results = message.match(/\b\d+\s+(?:passed|failed|skipped|pass|fail)|exit\s+0/gi) ?? [];
 return results.some(result => outputs.some(output => output.includes(result)));
}

const NORMAL_STOP_REASONS = new Set(['NO_TOOL_CALL', 'model_stop']);

// 자기 점검(self-check): 틀리기 쉬운 네 종류의 단정 문장이 최종 답변에 있으면 한 번만 되묻는다(차단이 아니라 재확인 요청).
// 실제 사례(2026-11-01): 조회 실패를 '기능 없음'으로, 로그 줄 수를 '로그인 N건'으로, 일부 확인을 '두 번 모두 맞다'로,
// 실행하지 않은 환경을 'Linux에서도 동작'으로 썼다.
const RISKY_CLAIMS = [
	{
		kind: '부재·불가 단정',
		re: /(?:기능|지원|플러그인|파일|기록|데이터|흔적|도구|방법|권한|모듈|옵션|명령|엔드포인트|설정|API|함수|이슈|키|패키지|라이브러리)(?:이|은|는|가|도)?\s*(?:전혀\s*)?(?:없[습다음어]|존재하지\s*않)|(?:지원|제공)(?:하|되)지\s*않|설치(?:되어|돼)\s*있지\s*않|사용되지\s*않|적이?\s*없[습다었]|불가능(?:합|하다)|할\s*수\s*없[습다]|안\s*됩니다|되지\s*않습니다|[Tt]here\s+(?:is|are)\s+no\b|\bno\s+such\b|\bdoes(?:n't|\s+not)\s+(?:support|exist|have)\b|\bis\s+not\s+supported\b/,
	},
	{ kind: '전체·전부 단정', re: /(?:모두|전부|모든|빠짐없이|하나(?:씩|하나)\s*다|일일이)\s*(?:[^\s.,]{0,8}\s+){0,2}?[^\s.,]{0,8}?(?:맞|통과|확인|일치|정상|성공|동작|검증|열립|표시)|\b(?:all|every|both|each)\b[^.]{0,40}?\b(?:pass(?:ed|es)?|returns?|returned|works?|worked|match(?:es|ed)?|identical|succeed(?:s|ed)?)\b/i },
	{
		kind: '실행 환경 단정',
		re: /(?:Linux|리눅스|Windows|윈도우|macOS|맥|Android|안드로이드|iOS|Ubuntu|우분투|Debian|크롬|Chrome|사파리|Safari|Python\s*\d[\d.]*|Node(?:\.js)?\s*\d+)(?:\s*\d[\d.]*)?(?:\s*·\s*\S+)?(?:\s*(?:이상|이하))?(?:에서|이면)(?:도|는)?\s*(?:[^\s.,]{1,8}\s+){0,4}(?:동작|작동|실행|사용|돌아|표시)(?:한다|합니다|됩니다|된다|가능|갑니다|간다)|\b(?:works?|runs?)\s+(?:fine\s+|correctly\s+|well\s+)?on\s+(?:Linux|Windows|macOS|Ubuntu|Android|iOS)\b/,
	},
];
const SELF_HEDGE_RE = /미확인|확인하지\s*못|확인\s*못|추정|일\s*수\s*있|아직\s*(?:확인|시험|실행)|확인한\s*(?:범위|것만|\d+)|범위\s*(?:내|안)에서|조회한\s*범위|열람할\s*수\s*없|(?:확인|판단|조회|알)할\s*수\s*(?:없|가\s*없)|알\s*수\s*없|확인되지\s*않|예상\s*(?:출력|결과|값|동작)|으로\s*예상/;

const LOOKUP_FAIL_RE = /No such file or directory|cannot (?:find|access|open)|not found|ModuleNotFoundError|No module named|ImportError|Permission denied|Operation not permitted|does not exist|could not be found|No results found|\b0 results\b|Found 0\b|no matches|HTTP (?:403|404|410)|ObjectNotFound|ItemNotFoundException|PathNotFound|경로를 찾을 수 없|찾을 수 없습니다/i;
const FRESH_RE = /최신|latest|newest|most\s+recent|as\s+of\s+today|최근\s*(?:버전|릴리스|출시|발표)|가장\s*(?:새로운|최근)|요즘|현재\s*(?:\S{1,15}\s*)?(?:버전|가격|시세|환율|주가|대통령|CEO|대표)|current\s+(?:version|release|price)/i;
const HOST_ENV_RE = { darwin: /macOS|맥|Mac/, linux: /Linux|리눅스|Ubuntu|우분투/, win32: /Windows|윈도우|PowerShell|파워셸|cmd\.exe/i }[process.platform];
const REMOTE_ENV_RE = /docker|podman|wsl|ssh|vagrant|multipass|limactl|qemu/i;
const POLICY_RE = /승인|허가|규칙|정책|금지/;
const RUN_CALL_RE = /run_command|terminal|exec|bash|shell|test/i;
const PRED_RE = /(?:면|후(?:에)?(?:도)?|으로|로)\s+[^.]{0,30}?(?:통과|성공|해결|유지|동작|작동|복구)(?:합니다|됩니다|한다|된다)|(?:빌드|테스트|배포)(?:는|가)\s*(?:[^\s.]+\s+)?(?:성공|통과)합니다|\bwill\s+(?:pass|succeed|work|fix|resolve)\b|\b(?:fix|patch|change)\s+(?:resolves|fixes|solves)\b/i;
const KO_NUM = { 두: 2, 세: 3, 네: 4, 다섯: 5 };
// 사용자가 물은 환경이 이 호스트 OS 가 아니면, 그 환경에서의 실행 결과는 예상일 뿐이다. 실세션(2026-11-01):
// 'Windows에서 실행하면 무엇이 출력되나' → '`\` (백슬래시)가 출력됩니다.'(macOS 에서 실행하지 않음).
const OTHER_ENV_RE = {
	darwin: /Windows|윈도우|Linux|리눅스|Ubuntu|우분투|Android|안드로이드|iOS|아이폰/i,
	linux: /Windows|윈도우|macOS|맥OS|맥북|Android|안드로이드|iOS|아이폰/i,
	win32: /Linux|리눅스|Ubuntu|우분투|macOS|맥OS|맥북|Android|안드로이드|iOS|아이폰/i,
}[process.platform];
const OUTCOME_RE = /출력(?:됩니다|된다)|나옵니다|나온다|반환(?:합니다|한다|됩니다)|(?:동작|작동)(?:합니다|한다)|실행됩니다|돌아갑니다/;
const NUM_CLAIM_RE = /(\d[\d,]*(?:\.\d+)?)\s?(건|회|번|개|명|줄|%|퍼센트|MB|GB|KB|ms|초|분|errors?|times|files?|users?|requests?|records?|rows?|lines?|tests?|failures?)/gi;

// 이번 턴(마지막 USER_INPUT 이후, 없으면 마지막 SYSTEM_MESSAGE 이후)에 실제로 실행한 것: 도구 호출 수, 검색 수, 실패한 조회 수, 도구 출력, 사용자 메시지.
export function turnEvidence(content) {
	if (!content) return null;
	const steps = content.split('\n').filter(Boolean).map((l) => {
		try {
			return JSON.parse(l);
		} catch {
			return null;
		}
	}).filter(Boolean);
	if (!steps.length) return null;
	let start = -1;
	for (let i = steps.length - 1; i >= 0; i--) {
		if (steps[i].type === 'USER_INPUT') {
			start = i;
			break;
		}
	}
	if (start < 0) {
		for (let i = steps.length - 1; i >= 0; i--) {
			if (steps[i].type === 'SYSTEM_MESSAGE' && !/Stop hook blocked termination:/i.test(String(steps[i].content || ''))) {
				start = i;
				break;
			}
		}
	}
	if (start < 0) start = 0;
	const turn = steps.slice(start);
	const calls = turn.flatMap((s) => (Array.isArray(s.tool_calls) ? s.tool_calls : []));
	const outs = turn.filter((s) => s.type === 'GENERIC').map((s) => String(s.content || ''));
	return {
		turnKey: `${start}:${String(steps[start]?.content || '').length}`,
		calls: calls.length,
		searches: calls.filter((c) => /search_web|web_search|read_url/i.test(String(c.name || ''))).length,
		runs: calls.filter((c) => RUN_CALL_RE.test(String(c.name || ''))).length,
		args: JSON.stringify(calls.map((c) => c.args ?? c.arguments ?? c.input ?? '')),
		cmdArgs: JSON.stringify(calls.filter((c) => RUN_CALL_RE.test(String(c.name || ''))).map((c) => c.args ?? c.arguments ?? c.input ?? '')),
		names: calls.map((c) => String(c.name || '')),
		// PowerShell Test-Path 는 없는 경로에 exit 0 + 'False' 만 남긴다(Windows QA, 2026-11-02).
		failed: outs.filter((o) => LOOKUP_FAIL_RE.test(o)).length + (calls.some((c) => /Test-Path/i.test(JSON.stringify(c.args ?? ''))) && outs.some((o) => /(?:^|\n)\s*False\s*(?:\r?\n|$)/.test(o)) ? 1 : 0),
		outputs: outs.join('\n').replace(/(?<=\d),(?=\d{3})/g, ''),
		user: String(turn[0]?.type === 'USER_INPUT' || turn[0]?.type === 'SYSTEM_MESSAGE' ? turn[0].content || '' : ''),
		// 이전 턴의 도구 출력·사용자 메시지(모델 답변은 제외). '지금까지 한 것을 정리해줘' 같은 턴은 앞 턴에서 얻은
		// 수치를 옮긴다. 실제 transcript 1052턴 리플레이(2026-11-02): 이번 턴만 보면 59% 턴이 되물음, 이전 턴 출력까지 보면 44%.
		// 줄 번호('137: …')·열람 머리글·시각·긴 16진수(해시)는 근거 수치가 아니다(적대적 리뷰 2026-11-03: 줄 번호 137 이
		// '총 137건'의 근거로 잡혔다).
		history: steps.slice(0, start).filter((s) => s.type === 'GENERIC' || s.type === 'USER_INPUT' || s.type === 'SYSTEM_MESSAGE').map((s) => String(s.content || '')).join('\n')
			.replace(/^(?:Created At|Completed At|Showing lines|Partial read|Total Lines|File Path)\b[^\n]*$/gim, ' ')
			.replace(/^\s*\d+:\s/gm, '')
			.replace(/\b[0-9a-f]{8,}\b/gi, ' ')
			.replace(/(?<=\d),(?=\d{3})/g, ''),
	};
}

// '점검: 근거 있음 — …' 답은 그대로 믿지 않는다. 인용한 문자열(`…`, "…")이 이번 턴의 도구 출력이나
// 실행한 명령 인자에 없으면 한 번 더 묻는다(요청당 최대 두 번 규칙 안에서).
function unsupportedEvidence(message, ev) {
	if (!message || !ev || !/점검\s*:\s*근거\s*있음/.test(message)) return [];
	const norm = (s) => s.replace(/\\\\/g, '\\').replace(/\s+/g, ' ').trim();
	// 호출한 도구 이름(`read_file`)을 인용한 것은 근거 인용 불일치가 아니다(Windows 실기 2026-11-03).
	const pool = norm(`${ev.outputs}\n${ev.args || ''}\n${(ev.names || []).join('\n')}`);
	const cites = [...message.matchAll(/`([^`\n]{3,200})`|"([^"\n]{3,200})"/g)].map((m) => norm(m[1] || m[2]));
	const missing = cites.filter((c) => !pool.includes(c));
	return missing.length
		? [{ kind: '근거 인용 불일치', sentence: `이번 턴 도구 출력·명령에 없는 인용: ${missing.slice(0, 5).join(' | ')}`.slice(0, 200) }]
		: [];
}

const PATHISH_RE = /^[\w~.:-]*[\\/]\S*$|^[\w.-]+\.\w{1,5}$/;

export function riskySentences(message, ev = null) {
	// 인라인 코드는 지우되, 경로·파일명은 남겨 범위 판정에 쓴다. 실기(2026-11-03): '`C:/temp/lazyqa/registry_parser.py` 파일이
	// 존재하지 않습니다'에서 경로가 지워져 부재 단정으로 되물었다.
	const text = message.replace(/```[\s\S]*?```/g, ' ').replace(/`([^`\n]*)`/g, (m, c) => (PATHISH_RE.test(c.trim()) ? c : ' '));
	// 부재 단정은 근거가 약한 턴에서만 되묻는다: 조회가 없었거나, 실패했거나, 검색 1~2회뿐인 턴.
	// 빈 결과가 '실패'로 세어지므로, 3회 이상 조회해 일부라도 성공한 턴은 약한 근거로 보지 않는다.
	const weak = !ev || ev.calls === 0 || (ev.failed > 0 && (ev.calls < 3 || ev.failed === ev.calls)) || (ev.searches > 0 && ev.searches <= 2 && ev.calls === ev.searches);
	const out = [];
	for (const s of text.split(/(?<=[.!?。])\s+|\n+/)) {
		const line = s.trim();
		if (!line) continue;
		if (SELF_HEDGE_RE.test(line)) {
			// 유보 절과 환경 단정 절이 한 문장에 섞이면 단정 절을 따로 본다. 실세션(2026-11-01):
			// 'Windows에서 직접 실행해 확인하지는 못했으나, … Windows에서 문제없이 동작합니다.'
			const env = RISKY_CLAIMS.find((c) => c.kind === '실행 환경 단정');
			if (line.split(/(?:으나|지만|는데|,)\s*/).some((c) => env.re.test(c) && !SELF_HEDGE_RE.test(c))) {
				out.push({ kind: env.kind, sentence: line.slice(0, 200) });
			}
			if (out.length >= 8) break;
			continue;
		}
		// 직접 조회한 경로를 이름으로 대는 부재 문장('…/x.py: 파일 없음')은 그 조회 범위에 맞춘 서술이다.
		// Windows 경로(C:\temp\x.py)와, 출력에는 False 만 남고 경로는 명령 인자에만 있는 Test-Path 도 범위 서술로 본다.
		const seen = ev ? `${ev.outputs}\n${String(ev.args || '').replace(/\\\\/g, '\\')}` : '';
		const scoped = ev && (line.match(/[A-Za-z]:\\[^\s"'`]+|[~\w.-]*\/[\w.\/-]+|[\w-]+\.(?:py|js|mjs|ts|json|md|ya?ml|log|sh|txt|go|rs|c)\b/g) || []).some((t) => {
			const u = t.replace(/[.,)]+$/, '');
			return t.length > 3 && (seen.includes(u) || seen.includes(u.replace(/\//g, '\\'))); // C:/x 와 C:\x 는 같은 경로
		});
		const inOut = (d) => ev && new RegExp(`(?<![\\d.])${d.replace(/\./g, '\\.')}(?![\\d])`).test(ev.outputs);
		const allOk = () => {
			const m = line.match(/(\d+)\s*(?:개|번|회|files?|tests?|runs?)|(두|세|네|다섯)\s*(?:번|개|파일|곳)?\s|\b(both)\b/i);
			const q = m ? Number(m[1] || KO_NUM[m[2]] || 2) : 0;
			return Boolean(ev && q && (ev.calls >= q || new RegExp(`(?<![\\d])${q}\\s*(?:passed|ok)`).test(ev.outputs)));
		};
		let hit = RISKY_CLAIMS.find((c) => {
			const m = line.match(c.re);
			if (!m) return false;
			// 경로를 대도 기능·지원으로 넓힌 부재 단정은 범위 서술이 아니다(적대적 리뷰 2026-11-03).
			if (c.kind === '부재·불가 단정') return weak && !(scoped && !BROAD_ABSENCE_RE.test(line)) && !POLICY_RE.test(line);
			if (c.kind === '전체·전부 단정') return !allOk();
			if (c.kind === '실행 환경 단정') return !(HOST_ENV_RE && HOST_ENV_RE.test(m[0]) && ev && ev.calls > 0);
			return true;
		});
		// 웹 조회 없이 쓴 최신·현재 정보는 학습 시점 기억이다(로컬 파일만 본 턴 포함). 실세션(2026-11-01): '현재 Python 최신 안정 버전은 3.13입니다.'
		if (!hit && ev && ev.searches === 0 && FRESH_RE.test(line) && !(line.match(/[\w.]*\d[\w.]*/g) || []).some((t) => t.length > 1 && ev.outputs.includes(t))) hit = { kind: '확인 안 한 최신·현재 정보' };
		// 문장 자체가 이 호스트 환경(예: Windows 의 PowerShell)을 말하면 다른 OS 단정이 아니다(Windows QA 오탐, 2026-11-02).
		if (!hit && ev && OTHER_ENV_RE && OTHER_ENV_RE.test(ev.user) && OUTCOME_RE.test(line) && !(HOST_ENV_RE && HOST_ENV_RE.test(line)) && !(ev.runs > 0 && REMOTE_ENV_RE.test(ev.args))) hit = { kind: '실행하지 않은 환경의 결과 단정' };
		// 이번 턴에 아무것도 실행하지 않고 '하면 통과합니다/해결됩니다' 를 쓰면 예상을 사실로 말한 것이다.
		if (!hit && ev && ev.runs === 0 && PRED_RE.test(line)) hit = { kind: '실행하지 않은 결과 예측 단정' };
		if (!hit && ev) {
			const scrubbedLine = line
				.replace(/#L\d+(?:-L?\d+)?/gi, ' ')
				.replace(/:\d+-\d+(?!\d)/g, ' ')
				.replace(/(?<!\d)0(?:1[016789]|2)-\d{3,4}-\d{4}(?!\d)/g, ' ');
			const calc = scrubbedLine.match(/(\d+)\s*[\/÷×*+-]\s*(\d+)/);
			for (const m of calc && inOut(calc[1]) && inOut(calc[2]) ? [] : scrubbedLine.matchAll(NUM_CLAIM_RE)) {
				const digits = m[1].replace(/,/g, '');
				if (Number(digits) < 2) continue;
				const re = new RegExp(`(?<![\\d.])${digits.replace('.', '\\.')}(?![\\d])`);
				if (!re.test(ev.outputs) && !re.test(ev.user) && !new RegExp(`(?<![\\w.])${digits.replace('.', '\\.')}(?![\\d.])`).test(ev.history)) {
					hit = { kind: `출처 없는 수치(${m[0]})` };
					break;
				}
				// 줄 수(wc -l, 'N lines')를 줄이 아닌 이름(건·명·회)으로 쓴 경우.
				// ls·find 출력을 wc -l 로 센 것은 항목(파일) 수다. 실세션(2026-11-01): 'ls *.py | wc -l' → '.py 파일 3개' 오탐.
				// write_file/edit_file 마크다운 본문에 적힌 `wc -l` 문구가 다른 숫자를 오탐하지 않도록 셸 명령 인자(cmdArgs)와 출력 줄만 대조한다.
				const cmdArgs = ev.cmdArgs ?? ev.args ?? '';
				const entryCount = /\b(?:ls|find|fd|grep\s+-[a-zA-Z]*l[a-zA-Z]*)\b[^|\n]*\|\s*wc\s+-l/.test(cmdArgs);
				const wcLineOut = !entryCount && /wc\s+-l/.test(cmdArgs) && new RegExp(`(?:^|\\n)\\s*${digits}(?:\\s+\\S+)?\\s*(?:\\r?\\n|$)`).test(ev.outputs);
				const lineCount = wcLineOut || new RegExp(`^\\s*${digits}\\s+lines?\\b`, 'im').test(ev.outputs); // read_file 머리글·코드 속 'lines' 는 줄 수 출력이 아니다
				if (lineCount && !/^(?:줄|lines?)$/i.test(m[2])) {
					hit = { kind: `줄 수를 다른 이름으로 쓴 수치(${m[0]})` };
					break;
				}
			}
		}
		if (hit) out.push({ kind: hit.kind, sentence: line.slice(0, 200) });
		if (out.length >= 8) break;
	}
	return out;
}

function selfCheckReason(risky) {
	return [
		`[SELF-CHECK v${GUARD_PACK_VERSION}] 최종 답변에 근거 확인이 필요한 문장이 있다. 각 문장을 이번 세션의 도구 결과와 대조하라. 근거를 대지 못하는 문장만 고친 문장으로 짧게 다시 말하고(답변 전체를 반복하지 않는다), 모두 근거가 있으면 '점검: 근거 있음 — <문장별 근거 도구 결과 한 줄>'로만 답한다.`,
		'- 없다·안 된다: 조회로 직접 본 범위(예: "그 경로에 파일 없음")는 사실이므로 그대로 쓴다. 그 범위를 넘어 넓힌 말(예: "기능이 없다")만 "확인하지 못했다"로 바꾼다. 조회가 실패했으면 그 조회로는 아무것도 단정하지 않는다.',
		'- 모두·전부: 하나하나 확인했는가? 일부만 확인했으면 확인한 범위를 적는다.',
		'- 숫자: 이번 턴 도구 출력에 있는 값인가? 실제로 센 대상의 이름으로 적었는가? (예: 로그 줄 수를 로그인 횟수로 쓰지 않는다) 계산한 값이면 계산식을 적는다.',
		'- 최신·현재 정보: 이번 턴에 확인한 출처가 있는가? 없으면 "학습 시점 기준이며 지금은 확인하지 못했다"로 쓴다.',
		'- ○○에서 동작: 그 환경에서 실제로 실행했는가? 아니면 "미확인"으로 쓴다.',
		'점검할 문장:',
		...risky.map((r, i) => `${i + 1}. [${r.kind}] ${r.sentence}`),
	].join('\n');
}

let LAST_MESSAGE = '';

// Observe log home: an absolute workspace from the payload, never the hook's cwd (the plugin repo).
// 숫자 되묻기는 보고서·증거 작업 턴에서만 한다. 그 밖의 턴(가격 비교, 설치 안내 등)은 기록만 남긴다
// (사용자 결정 2026-11-02: 실제 1052턴 리플레이에서 숫자 되묻기 대부분이 포렌식과 무관한 대화였다).
const NUMERIC_KIND_RE = /^(?:출처 없는 수치|줄 수를 다른 이름으로 쓴 수치)/;
const REPORT_WRITE_RE = /write_to_file|write_file|replace_file_content|edit_file|apply_patch|str_replace|search_replace|generate_document|fill_form|patch_document/i;
const REPORT_FILE_RE = /\.(?:md|docx?|hwpx?|html?|pdf)\b/i;
const EVIDENCE_DIR_NAMES = ['case', 'evidence', '증거', '자료', '원본', 'sources', 'attachments', '첨부'];
const EVIDENCE_PATH_RE = new RegExp(`[\\\\/](?:${EVIDENCE_DIR_NAMES.join('|')})[\\\\/]`, 'i');
// 리플레이 표본(2026-11-02)에서 데이터 정리 턴('방별로 수신자·발신자 엑셀 정리', '타임라인')이 빠져 있어 함께 둔다.
const FORENSIC_ASK_RE = /보고서|감정서|의견서|포렌식|증거|감정|진술|고소|소장|판결|사건|대화 내보내기|카카오톡|카톡|타임라인|엑셀|명단|집계|건수|몇\s*(?:건|개|명|회|번)|수집|추출|발신|수신|report|forensic|evidence|timeline/i;

const DATA_FILE_RE = /\.(?:log|csv|tsv|xlsx?|db|sqlite3?|evtx|pcap|pcapng|plist|jsonl)\b/i;
const BROAD_ABSENCE_RE = /(?:기능|지원|방법|권한|모듈|옵션|명령|엔드포인트|설정|API|함수|패키지|라이브러리|플러그인|도구)(?:이|은|는|가|도)?\s*(?:전혀\s*)?(?:없|존재하지\s*않)|(?:지원|제공)(?:하|되)지\s*않|불가능|할\s*수\s*없|\bdoes(?:n't|\s+not)\s+(?:support|have)\b|\bis\s+not\s+supported\b/i;

function isReportTurn(ev, payload) {
	if (!ev) return true; // 판단할 근거가 없으면 지금처럼 묻는다
	if (FORENSIC_ASK_RE.test(ev.user)) return true;
	const args = ev.args.replace(/\\\\/g, '\\');
	if (EVIDENCE_PATH_RE.test(args)) return true;
	// 로그·데이터 파일을 다룬 턴은 증거 작업이다. 2026-11-01 사례('wc -l auth.log' → '로그인 3건')가
	// 기록만 되고 되묻지 않았다(적대적 리뷰 2026-11-03).
	if (DATA_FILE_RE.test(args)) return true;
	if (ev.names.some((n) => REPORT_WRITE_RE.test(n)) && REPORT_FILE_RE.test(args)) return true;
	const ws = observeLogBase(payload);
	return Boolean(ws) && ws !== os.homedir() && EVIDENCE_DIR_NAMES.some((d) => fs.existsSync(path.join(ws, d)));
}

// Observe logs live only in the payload's absolute workspace. Unknown workspace → no log, never the home folder.
function observeLogBase(payload) {
	return resolveWorkspace(payload, null);
}

// Answer text may carry case content (names, counts, conclusions). Logs keep only a fingerprint.
export function textDigest(text) {
	const value = String(text ?? '');
	return { sha256: createHash('sha256').update(value, 'utf8').digest('hex'), length: value.length };
}

const loggedSentences = (items) => items.map(({ kind, sentence }) => ({ kind, ...textDigest(sentence) }));

function appendObserveLog(payload, entry, label) {
	const base = observeLogBase(payload);
	if (!base) return;
	try {
		const dir = path.join(base, '.lazyneon');
		fs.mkdirSync(dir, { recursive: true });
		fs.appendFileSync(path.join(dir, 'stop-guard.jsonl'), `${JSON.stringify({ plugin: pluginProvenance(), ts: new Date().toISOString(), ...entry })}\n`);
	} catch (err) {
		process.stderr.write(`stop_claim_guard: ${label} log failed: ${err.message}\n`);
	}
}

function emitBlock(payload, reason) {
	if ((process.env.LAZYNEON_STOP_GUARD || '').trim().toLowerCase() === 'enforce') {
		process.stdout.write(`${JSON.stringify({ decision: 'continue', reason })}\n`);
		process.exit(0);
	}
	appendObserveLog(payload, {
		mode: 'observe',
		would_block: true,
		conversationId: payload.conversationId || null,
		reason: reason.slice(0, 300),
		answer: textDigest(LAST_MESSAGE),
	}, 'observe');
	process.stdout.write('{}\n');
	process.exit(0);
}

async function main() {
	let payload;
	let raw = '';
	try {
		raw = await readStdin(1500);
		payload = JSON.parse(raw);
	} catch {
		process.stdout.write('{}\n');
		process.exit(0); // 판단 불가 — 개입하지 않음
	}
	if (!payload || typeof payload !== 'object') {
		process.stdout.write('{}\n');
		process.exit(0);
	}
	recordFailedLookups(raw);
	if (
		payload.stop_hook_active === true ||
		Number(payload.executionNum) >= 2 ||
		payload.fullyIdle === false
	) {
		process.stdout.write('{}\n');
		process.exit(0);
	}
	if (
		typeof payload.terminationReason === 'string' &&
		!NORMAL_STOP_REASONS.has(payload.terminationReason)
	) {
		process.stdout.write('{}\n');
		process.exit(0);
	}

	let transcriptContent = '';
	const transcriptPaths = resolveTranscriptPaths(payload);
	for (const tp of transcriptPaths) {
		try {
			transcriptContent = readTailContent(tp);
			if (transcriptContent) break;
		} catch {
			// continue
		}
	}

	const message =
		typeof payload.last_assistant_message === 'string' && payload.last_assistant_message
			? payload.last_assistant_message
			: typeof payload.finalModelOutput === 'string' && payload.finalModelOutput
				? payload.finalModelOutput
				: extractLastAssistantMessageFromTranscript(transcriptContent);
	LAST_MESSAGE = message || '';
	const ev = turnEvidence(transcriptContent);
	// 되묻기 정책: Antigravity Stop 은 첫 정지에 executionNum=0, 재진입 뒤 정지에 1 을 보낸다(실세션 2026-11-01 로그).
	// executionNum>=2 는 위에서 이미 통과시키므로 한 요청에 최대 두 번 묻는다. 두 번째는 이번 요청에서 아직 묻지 않은
	// 종류의 문장이 새로 생겼을 때만 묻는다(같은 종류를 다시 묻는 것은 실세션에서 오탐 반복이었다).
	const turnId = `${payload.conversationId || ''}#${ev ? ev.turnKey : ''}`;
	const asked = new Set();
	const logBase = observeLogBase(payload);
	try {
		if (!logBase) throw new Error('no workspace');
		const log = fs.readFileSync(path.join(logBase, '.lazyneon', 'stop-guard.jsonl'), 'utf8');
		for (const l of log.split('\n')) {
			if (!l.includes('"self_check"') || !l.includes(`"turn":${JSON.stringify(turnId)}`)) continue;
			try {
				for (const s of JSON.parse(l).sentences || []) asked.add(s.kind);
			} catch {
				// 깨진 줄은 건너뛴다
			}
		}
	} catch {
		// 기록 없음 — 첫 질문
	}
	const found = [...(message ? riskySentences(message, ev) : []), ...unsupportedEvidence(message, ev)].filter((r) => !asked.has(r.kind));
	const deferred = isReportTurn(ev, payload) ? [] : found.filter((r) => NUMERIC_KIND_RE.test(r.kind));
	const risky = found.filter((r) => !deferred.includes(r));
	if (deferred.length) {
		appendObserveLog(payload, { mode: 'observe_numeric', turn: turnId, conversationId: payload.conversationId || null, sentences: loggedSentences(deferred) }, 'numeric observe');
	}
	// 증거 없는 완료 선언('모든 검증을 완료했다'): enforce 면 아래 완료 선언 가드가 막는다.
	// observe 면 그 가드는 기록만 하므로, 기록을 남기고 자기 점검으로 한 번 묻는다(측정: 미루면 '세 파일 모두 통과' 류가 아무 질문 없이 나갔다).
	const evidenceCwd = resolveWorkspace(payload);
	const hasEvidence = completionEvidence(message, transcriptContent, evidenceCwd);
	const legacyClaim = Boolean(message) && CLAIM_RE.test(message) && !hasEvidence;
	const enforceMode = (process.env.LAZYNEON_STOP_GUARD || '').trim().toLowerCase() === 'enforce';
	if (risky.length && !(legacyClaim && enforceMode) && settings().selfCheck) {
		if (legacyClaim) {
			appendObserveLog(payload, { mode: 'observe', would_block: true, conversationId: payload.conversationId || null, reason: `[STOP CLAIM GUARD v${GUARD_PACK_VERSION}] 완료 선언에 반증 가능한 증거가 없다(자기 점검으로 대신 물음).`, answer: textDigest(message) }, 'observe');
		}
		appendObserveLog(payload, { mode: 'self_check', turn: turnId, conversationId: payload.conversationId || null, executionNum: payload.executionNum ?? null, stop_hook_active: payload.stop_hook_active ?? null, payload_keys: Object.keys(payload), sentences: loggedSentences(risky) }, 'self-check');
		process.stdout.write(`${JSON.stringify({ decision: 'continue', reason: selfCheckReason(risky) })}\n`);
		process.exit(0);
	}
	if (!message || !CLAIM_RE.test(message)) {
		process.stdout.write('{}\n');
		process.exit(0);
	}
	if (hasEvidence) {
		// Feature 15: Fact-Retracing Gate (v2) + OMH 4-Stage DAG Completion Integrity
		// Verify high-risk claimed file paths against disk and transcript
		const baseCwd = resolveWorkspace(payload);

		const dagPath = path.join(baseCwd, '.lazyneon', 'ulw-dag.json');
		if (fs.existsSync(dagPath)) {
			try {
				const dag = JSON.parse(fs.readFileSync(dagPath, 'utf8'));
				const unverifiedNodes = (Array.isArray(dag.nodes) ? dag.nodes : []).filter((n) => n && n.state === 'reported_done');
				if (unverifiedNodes.length > 0) {
					const ids = unverifiedNodes.map((n) => n.id).join(', ');
					emitBlock(
						payload,
						`[STOP CLAIM GUARD v${GUARD_PACK_VERSION}] 4단계 증거 등급 위반(reported_done != verified): .lazyneon/ulw-dag.json 노드 [${ids}]가 아직 'verified' 상태가 아닙니다. 검증 명령을 실행해 settle 한 뒤 완료를 선언하십시오.`,
					);
				}
			} catch {
				// ignore malformed dag file
			}
		}

		const claimedFileMatches = message.matchAll(/(?:(?:생성|작성|수정|추가|산출물)(?:은|는|이|가|로|으로)?|(?:created|written|generated|file|path))\s*[:=]?\s*[`"']?([a-zA-Z0-9_.:/\\가-힣-]+\.(?:ts|js|mjs|py|go|rs|json|md))[`"']?/gi);
		for (const match of claimedFileMatches) {
			const claimedPath = match[1];
			const fullPath = path.isAbsolute(claimedPath)
				? path.normalize(claimedPath)
				: path.resolve(baseCwd, claimedPath);
			let existsOnDisk = false;
			try { existsOnDisk = fs.statSync(fullPath).isFile(); } catch {}

			if (!existsOnDisk) {
				emitBlock(
					payload,
					`[STOP CLAIM GUARD v${GUARD_PACK_VERSION}] 사실 역추적(Fact-Retracing) 실패: 메시지에 완료 산출물로 주장된 파일 "${claimedPath}"이 디스크에 파일로 존재하지 않습니다. 허위 파일 경로 생성을 차단합니다.`,
				);
			}
		}

		process.stdout.write('{}\n'); // 증거 있는 선언 — 통과
		process.exit(0);
	}

	const reason = [
		`[STOP CLAIM GUARD v${GUARD_PACK_VERSION}] 완료 선언에 반증 가능한 증거가 없다.`,
		'메시지에 완료/전수/100% 류의 선언이 있지만 실행 명령·테스트 수·산출물 경로·커밋 SHA 중 어느 것도 제시하지 않았다.',
		'다음 중 해당하는 증거를 메시지에 덧붙여라:',
		'  1. 실제로 실행한 검증 명령 원문과 요약 출력 (예: pytest ... → "N passed")',
		'  2. 생성/수정한 산출물의 경로, 또는 읽기 전용 검토라면 이번 턴에 성공적으로 읽은 파일 경로나 백틱으로 감싼 읽기 명령 원문',
		'  3. 커밋/푸시했다면 커밋 SHA',
		'증거를 제시할 수 없는 항목은 "완료"라고 쓰지 말고 현재 상태를 사실대로 서술하라 (미확인/미측정 표기).',
		'이 선언이 단순 상태 보고라면 과장 표현을 빼고 사실만 쓰면 통과한다.',
	].join('\n');
	emitBlock(payload, reason);
}

if (isMainModule(import.meta.url)) {
	main().catch((err) => {
		process.stderr.write(`stop_claim_guard: internal error: ${err?.stack || err}\n`); // 조용한 통과와 충돌을 구별한다
		process.stdout.write('{}\n');
		process.exit(0); // 어떤 경우에도 세션을 가두지 않는다
	});
}
