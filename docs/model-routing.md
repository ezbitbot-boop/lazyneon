# LazyNeon 0.2.0 라우팅 (2026-11-20)

공식 모델 ID는 `gemini-4-neon`이다(2026-11-19 확인). 사고 수준은 `LOW`, `MEDIUM`, `HIGH`(기본), `XHIGH`이며 `thinking_budget` 또는 `thinking_level="MINIMAL"`은 HTTP 400을 반환한다. 입력과 출력(사고·함수 호출·응답)을 합친 **1,048,576 토큰 통합 한도**를 쓴다. 공식 오케스트레이션은 Neon이 계획·검증하고 `gemini-4-hydrogen` 워커가 Interactions API의 `previous_interaction_id`로 작업을 이어가는 방식이다.

출처: [Google Cloud 공식 가이드](https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/guides/gemini-4-neon), [AI Studio deprecations](https://aistudio.google.com/docs/deprecations). `-low/-medium/-high/-xhigh`는 이 저장소의 라우팅 표기이며 호스트 tier 매핑은 별도 미검증이다.

**2026-11-20 소유자 요청으로 Argon을 라우팅에서 제거했다.** [미측정] 통과율 실측 전: 기본·구현은 Neon high → medium, 일반 리뷰·계획·최종 리뷰·보안·PII·포렌식 게이트는 Neon high 기준선이며 실패 검증·인터페이스 변경·상충 근거(reason/evidence)가 있는 경우만 xhigh로 승격한다. 지연·실패 뒤 자동 중복 호출은 하지 않는다. 긴 컨텍스트는 Neon high → Carbon high. Hydrogen high는 장기 실행·병렬 워커 전용이며 게이트에 금지한다. 역사적 측정은 Neon 성능을 뜻하지 않는다.

## Argon medium vs high on hard verdicts (carbon-medium-1115, 2026-11-15)

The 41 round-3 cases (picked because other models got them wrong), same runner, prompts and grader as round 3; agy 1.5.9, isolated HOME, 15-minute cap per case. The Argon high arm reuses round 3; a 5-case drift check (seed 1115) reproduced it 5/5.

| Arm | Correct /41 | Confidently wrong | Timeouts | Median s | Total tokens | Output tokens |
|---|---|---|---|---|---|---|
| Argon medium | 22 | 19 | 0 | 14.3 | 572k | 52k |
| Argon high | 22 | 19 | 0 | 42.1 | 776k | 207k |
| Carbon medium | 20 | 21 | 0 | 118.1 | 1,514k | 610k |

Argon medium and high solved the identical set of cases. Sign test Carbon medium vs Argon high: 1 vs 3 cases, p = 0.625. The whole lane used about 1.6 weekly points. Limits: the case set is biased toward hard misses, and n = 41 cannot resolve a 2-case gap; medium is unmeasured on implementation, planning and the v2 sensitive checks.

## Implementation arms (orch-pilot, 2026-11-13)

Five F13 code-fix cases (edit a Python file until hidden tests pass), run sequentially with agy 1.5.6. "Plain" arms ran in an isolated HOME without the lazyargon plugin. Quota is the drop in weekly percentage across the arm; readings are noisy at this size.

| Arm | n | Pass | Median s | Tokens/case | Weekly pts |
|---|---|---|---|---|---|
| plain Argon high | 5 | 5 | 32 | 17.5k | 0.01 |
| plain Hydrogen high | 5 | 5 | 28 | 22.8k | ~0 |
| subagents (Argon high) | 5 | 5 | 131 | 33.3k | 0.32 |
| built-in Orchestrator | 5 | 5 | 110 | 47.0k | 0.35 |
| lazyorch (plan/work/review) | 5 | 5 | 202 | 78.8k | 0.28 |
| lazy (3-stage /ulw) | 5 | 5 | 182 | 109.2k | 0.35 |
| swarm (Carbon coordinator) | 3 | 3 | 247 | ~87k | 0.80 |
| boost | 2 | 2 | ~100 | ~27.5k | n/a |

Every arm passed every case, so these cases cannot separate quality; the default is chosen on cost. They are easy single-file fixes. Orchestration modes are unmeasured on large multi-file tasks, where they may pay for themselves. Revisit when harder cases are added.

## Limit of this evidence: F13 is at ceiling

Every arm passed every F13 case, so F13 separates cost but not performance. The default (single-session Argon high) is chosen on cost only. Next step: at least 10 harder multi-file implementation cases with Carbon-only and Argon-only arms added, timeouts counted as failures, before any orchestration mode is adopted or rejected on quality.

## 100-case verdict comparison (2026-11-13)

Same 100 cases for each model (13 families), original bench prompt, agy print timeout 10 min counted as an error. Built from the first test plus a fill-in run of 119 calls.

| Model | Exact | Errors / timeouts | Exact when answered | Missed bad (said pass) | False alarm on clean | PII caught | Inject caught | Median s |
|---|---|---|---|---|---|---|---|---|
| Argon high | 72 | 1 | 72.7% | 7/67 | 7/33 | 3/6 | 5/5 | 38 |
| Carbon high | 62 | 14 | 72.1% | 4/67 | 7/33 | 0/6 | 5/5 | 212 |
| Hydrogen high | 65 | 0 | 65.0% | 9/67 | 10/33 | 2/6 | 5/5 | 24 |

The fill-in run used about 4 weekly points for 119 calls (about 0.034 per call). Carbon's errors were 10-minute print timeouts concentrated in image cases (7 of 14), so they measure latency, not accuracy; the 3 timeouts from the fill-in timed out again on a retry (2026-11-14). "Missed bad" excludes unanswered cases; counting them as misses, Carbon high missed 13/67 and Argon high 8/67. Bootstrap of the Argon minus Carbon exact gap (20,000 resamples): mean +10.0 points, 95% CI [+4, +17].

## Task router

세션 모델 해석은 `scripts/session-model.mjs` 하나를 공유한다. 우선순위는 비어 있지 않은 문자열인 payload의 `modelName` → `model_name` → `sessionModel` → `session_model` → `model` → `session.modelName` → `session.model`, 이어서 `ANTIGRAVITY_MODEL_NAME` → `ANTIGRAVITY_MODEL` → `unknown`이다. 분류 CLI는 payload를 받지 않으므로 환경변수 순서부터 적용한다. 공백 문자열은 건너뛰며 `GEMINI_MODEL`은 호스트 세션 보고값이 아니므로 사용하지 않는다. SessionStart가 주입한 `플러그인 경로:`를 명령의 설치 경로로 사용한다.

`/ulw` runs `node "<플러그인 경로>/scripts/classify-task.mjs" "<task description>"` at the start of every task (before writing `.lazyneon/ulw-scope.md`) and follows its JSON output. The classifier reads `task_kinds` from `skills/ulw/references/model-routing.json`; worker tiers are derived from `subagent_tiers`; only Neon is accepted as the orchestrator family. `ANTIGRAVITY_MODEL_NAME`/`ANTIGRAVITY_MODEL` can supply the host session model; Neon-only work in an Argon/Carbon/Hydrogen session refuses with "switch the model picker to Gemini 4 Neon", because no subagent tier reaches Neon (see `pro` below). Gate tasks run in the host-reported Neon session when its tier meets the requirement: classification records `pending` / `in_session`, never a passed verdict. The session must perform the review and retain evidence. Neon high satisfies the baseline; an evidenced promotion alone produces `xhigh 권장, high로 진행`; unknown levels proceed with a `[미확인]` notice. Protected tasks (`hydrogen_excluded`) also report `delegation: "forbidden"`: they never fan out and refuse non-Neon or Orchestrator sessions. SessionStart persists its report in `.lazyneon/session-model.json`; the shared resolver prefers direct host payload/environment, then workspace state (24-hour limit, matching session ID when supplied). A new SessionStart replaces old state even when unknown. CLI accepts a JSON host payload on stdin alongside the prompt argument. Delegation remains pending and requires real execution evidence.

| Task kind | Role | Model | Fallback |
|---|---|---|---|
| `final_review` | `final_review` | `gemini-4-neon-high` | `gemini-4-neon-high` |
| `security_audit` | `security_audit` | `gemini-4-neon-high` | `gemini-4-neon-high` |
| `forensic_verdict` | `forensic_verdict` | `gemini-4-neon-high` | `gemini-4-neon-high` |
| `count_extract` | `script_first` | `gemini-4-neon-medium` | `gemini-4-neon-medium` |
| `media_transcribe` | `tool_first` | `gemini-4-neon-medium` | `gemini-4-neon-medium` |
| `mechanical` | `mechanical` | `gemini-4-neon-medium` | `gemini-4-neon-medium` |
| `plan` | `plan` | `gemini-4-neon-high` | `gemini-4-neon-high` |
| `judgment` | `verdict_review` | `gemini-4-neon-high` | `gemini-4-neon-high` |
| `long_execution` | `long_execution` | `gemini-4-hydrogen-high` | `-` |
| `implementation` | `implementation` | `gemini-4-neon-high` | `gemini-4-neon-medium` |
| `sensitive` | `pii_inject_docfmt` | `gemini-4-neon-high` | `gemini-4-neon-high` |
| `long_context` | `long_context` | `gemini-4-neon-high` | `gemini-4-carbon-medium` |

Size (`single` / `subagents`): (1) ≥3 code-file paths in the prompt (e.g. `src/a.ts src/b.ts src/c.ts`) → subagents; (2) explicit file count ≥3 ("3 files", "3개 파일") → subagents; (3) `modes.subagents.size_signals` keywords ("parallel", "독립적", "여러 파일") → subagents; otherwise single.

**Verified paths inside a /ulw session:**
- `invoke_subagent Model: "pro"` — labelled Neon, but observed running as Hydrogen XHigh (`gemini-4-hydrogen-tiered-xhigh`, 33/33 runs) and `inherit` subagents after an Orchestrator plan inherit Hydrogen ([antigravity-cli #1824](https://github.com/google-antigravity/antigravity-cli/issues/1824), [#1710](https://github.com/google-antigravity/antigravity-cli/issues/1710); user reports, no Google confirmation). `subagent_tiers.pro` therefore records Hydrogen: no subagent tier reaches Neon, Neon-only gates in a non-Neon session refuse with "switch the model picker to Gemini 4 Neon" instead of delegating, and protected (PII/security/forensic/evidence) tasks get `delegation: "forbidden"` — no subagents and no Orchestrator session at all.
- `agy --model <id>` from a terminal — confirmed at the CLI level only.
- `agy --model <id>` via `run_command` inside a /ulw session (print mode, different tool permissions, separate context) — **unverified-nested**: never tested. Single Hydrogen tasks proceed in the current session model with the one-line notice; parallel execution instead fans out through the configured Hydrogen tier (host mapping still unverified). For single execution, the classifier emits `verified_path: "unverified-nested"` and `action: "proceed in session model + notice"`.

**Historical post-reset live-check plan (2026-11-14; not executed in this fix round)**:

```bash
# 1. Terminal: Hydrogen high via agy CLI (~1 small call, ~0.001 weekly pts)
agy -p "what is 2+2" --model gemini-4-hydrogen-high --print-timeout 60s --output-format text
# Expected: responds without error; session header confirms Hydrogen model. Exit 0.

# 2. Terminal: Carbon high via agy CLI (~1 small call, ~0.001 weekly pts)
agy -p "what is 2+2" --model gemini-4-carbon-high --print-timeout 60s --output-format text
# Expected: responds without error; session header confirms Carbon model. Exit 0.

# 3. Nested (read-only): agy called from inside a /ulw session via run_command (~1 small call, ~0.001 weekly pts)
# From inside an active /ulw session, run:
#   run_command: agy -p "what is 2+2" --model gemini-4-hydrogen-high --print-timeout 60s --output-format text
# Expected: responds without error. If this succeeds, verified_path for long_execution can be upgraded to
#   "agy --model gemini-4-hydrogen-high --print-timeout 600s --output-format text" in model-routing.json
#   and action changed to "delegate via agy --model ...".

# 4. Nested (edits scratch file): agy with --mode accept-edits from inside a /ulw session (~1 small call, ~0.001 weekly pts)
# Create scratch file: echo "TODO: replace me" > /tmp/ulw_scratch_test.txt
# From inside an active /ulw session, run:
#   run_command: agy -p "In /tmp/ulw_scratch_test.txt replace TODO with DONE" \
#     --model gemini-4-hydrogen-high --mode accept-edits --print-timeout 60s --output-format text
# Then: cat /tmp/ulw_scratch_test.txt
# Expected: file content updated (DONE: replace me or similar). Exit 0.
# If both #3 and #4 pass, the nested path is verified and action/verified_path can be updated.

# 5. Classifier shape check (no model calls, no quota cost)
node scripts/classify-task.mjs "이 PR 리뷰해줘" | node -e \
  "const j=JSON.parse(require('fs').readFileSync(0,'utf8')); \
   require('node:assert/strict').equal(j.kind,'judgment'); \
   require('node:assert/strict').equal(j.verified_path,'unverified-neon'); \
   console.log('shape ok')"
# Expected: "shape ok". Exit 0.
```

## Korean STT model (stt-models-1116, 2026-11-16)

Same 20 synthetic clips and grader as ocr-stt-1115 (14 natural voice, 6 robot TTS), isolated HOME, one agy call at a time. 현재 STT 모델: `gemini-4-neon-medium` (`tool_first.stt_model`, 미측정). 아래 Flash 결과는 과거 측정이다; the local pass stays faster-whisper large-v3-turbo + VAD.

| Model | Natural CER | Natural numbers | All-clip CER | Hallucinated words | s per clip |
|---|---|---|---|---|---|
| gemini-3.8-flash-high | 0.0% | 100% | 2.2% | 0 | 108 |
| gemini-4-argon-high | 0.1% | 98.9% | 3.8% | 28 | 68 |
| gemini-4-argon-medium | 0.3% | 97.8% | 6.0% | 81 | 31 |
| gemini-4-hydrogen-high | 2.1% | 93.1% | 6.7% | 64 | 36 |
| gemini-4-hydrogen-xhigh | 0.4% | 96.8% | 25.4% | 333 | 232 |

The owner's note that Hydrogen transcribes Korean better was not confirmed here. Natural voice is nearly a tie between Flash High and Argon High; robot TTS and silence gaps separate them. Small synthetic set: re-measure on real recordings before tightening.

**Real speech (stt-real-1116, 2026-11-16).** OpenSLR SLR40 Zeroth-Korean (CC BY 4.0), 8 utterances from 5 speakers, each with numbers, dates or amounts; plus phone (8 kHz mu-law), pink noise at 10 dB and a two-speaker join: 13 clips, 26 serialized agy calls.

| Model | Raw CER | Digit-normalized CER | Numbers | Invented sentences | s per clip |
|---|---|---|---|---|---|
| gemini-3.8-flash-high | 0.3% | 0.0% | 28/28 | 0 | 95 |
| gemini-4-argon-high | 13.0% | 0.0% | 28/28 | 0 | 93 |
| faster-whisper large-v3-turbo + VAD (local) | 16.8% | 1.2% | 27/28 | 0 | 6.4 |

A tie at the ceiling: the raw gap is notation (the reference and Flash spell numbers in Hangul, Argon writes Arabic numerals), and the earlier 1.6x time gap did not show on real speech. Historically `gemini-3.8-flash-high` was retained; its edge rested on the synthetic robot-TTS and silence conditions. Still unmeasured: natural conversation, overlapping speech, dialects and long recordings, so the `tool_first` rule keeps faster-whisper next to any Gemini transcription and a person checks numbers and names in evidence transcripts against the audio. `classify-task.mjs` emits `stt_model` for transcription tasks, and a test keeps the rule text and `stt_model` naming the same model.

## 역사적 근거 (LazyArgon, Argon 측정)

기존 JSON에서 이전한 원문이며 현재 라우팅에 사용하지 않는다.

- `roles.default.baseline_note`: 41 hard round-3 cases (carbon-medium-1115): Argon medium 22/41 = Argon high 22/41 with the identical set of solved cases, median 14 s vs 42 s, output tokens 52k vs 207k. Equal pass rate, so the cheaper arm wins under selection_rule.
- `roles.plan.baseline_note`: Argon high. Carbon high was as accurate when it answered (62/86 = 72.1% vs Argon 72/99 = 72.7%) but its latency (p50 212 s, p95 526 s) makes it impractical; a 180 s cap with Argon fallback scores 71/100 against Argon alone 72/100 with twice the calls. Only Carbon high was measured (medium unmeasured).
- `roles.final_review.baseline_note`: same evidence as plan
- `roles.long_context.min_context_tokens_note`: 250k threshold is an unmeasured assumption: no case near that size was tested and Argon high was not measured beyond it
- `roles.long_context.baseline_note`: Carbon high latency on the 100-case set: p50 212 s, p90 492 s, p95 526 s, so the cap is 600 s (a 180 s cap would cut off nearly every call). Fallback Argon high is unverified at this size.
- `roles.security_audit.baseline_note`: Counting unanswered cases as misses, Carbon high missed 13/67 bad cases and Argon high 8/67. Audits include injection and PII, so the v2 rule applies.
- `roles.verdict_review.baseline_note`: 41 hard round-3 cases: Argon medium 22/41 = Argon high 22/41 (same solved set; 2-case gaps are not resolvable at n=41), median 14 s vs 42 s, output tokens 52k vs 207k; Carbon medium 20/41 at 2.6x Argon medium's tokens. 100 common cases (Argon high only): 72/100 exact, 1 error, 38 s median; Hydrogen high 65/100 with the most clean false alarms (10/33)
- `roles.verdict_review.baseline_alternative`: gemini-4-hydrogen-xhigh
- `roles.implementation.baseline_note`: single session; pass 5/5 at ~17.5k tokens, ~32 s, ~0.01 weekly pts per 5 cases. Hydrogen high is the same pass rate (~22.8k tokens, ~28 s). Stays Argon high: Argon medium is unmeasured on implementation (the 41-case medium result covers verdicts only).
- `roles.long_execution.baseline_note`: test-verified execution only (long or flaky steps); never a gate: most clean false alarms on 100 cases (10/33) and 36% on the v2 retest
- `roles.pii_inject_docfmt.baseline_note`: Separate measurements, not comparable: on the 100-case set (original prompt, pii 7, inject 8 cases) PII was weak for every model (best 3/6 caught); on the v2 retest (pii 38, inject 32 cases) Argon, Carbon and Hydrogen xhigh caught 70/70. docfmt cases are partly a bench artifact (binary documents shown as 256-byte hex), so docfmt scores are not used for routing.
- `roles.pii_inject_docfmt.baseline_alternative`: gemini-4-hydrogen-xhigh
- `roles.script_first.baseline_note`: routing unchanged (Argon); rule from false-claims-1115 unexecuted-number repeats
- `roles.tool_first.baseline_note`: ocr-stt-1115 (synthetic, 20 clips / 30 images): STT natural-voice CER Gemini 0.1%, faster-whisper+VAD 1.2%, whisper.cpp 23.2%, Google web 36.7% (numbers 60.8%, drops numeric sentences); Gemini invented unrelated sentences on 2/5 unintelligible clips. OCR CER Gemini 0.0%, Claude Sonnet 0.1%, Apple Vision 2.2%, tesseract 12.9%. stt-models-1116 (same 20 clips): natural-voice CER / numbers / hallucinated words — 3.8 Flash High 0.0% / 100% / 0, Argon High 0.1% / 98.9% / 28, Argon Medium 0.3% / 97.8% / 81, Hydrogen High 2.1% / 93.1% / 64, Hydrogen XHigh 0.4% / 96.8% / 333 (232 s per clip). Hydrogen was not better for Korean STT; robot-TTS clips separate the models (Flash High CER 52.9% vs Argon High 87.9%). stt-real-1116 (real read speech, OpenSLR SLR40 Zeroth CC BY 4.0, 5 speakers, 13 clips: clean 8, phone 8 kHz mu-law 2, pink noise 10 dB 2, two-speaker 1): tie at the ceiling, digit-normalized CER 0.0% and numbers 28/28 for both Flash High and Argon High, no invented sentences, 95 vs 93 s per clip; raw CER 0.3% vs 13.0% is notation only (Argon writes Arabic numerals). faster-whisper+VAD 1.2% normalized, 27/28, 6.4 s. Flash High stays; its edge rests on the synthetic hard conditions. Unmeasured: natural conversation, overlapping speech, dialects, long recordings.
- `roles.forensic_verdict.baseline_note`: Argon medium: same 41 r3 forensic-verdict questions as verdict_review (medium-arms-1115: Argon medium 22/41 = Argon high, same cases, 26% fewer tokens). set2 100 cases: Argon high 72 > Hydrogen 65 > Carbon 62
- `roles.mechanical.baseline_note`: Hydrogen high is fastest here but cannot be selected inside /ulw (unverified-nested)
- `roles.parallel_workers.baseline_note`: test-verified execution only (long or flaky steps); never a gate: most clean false alarms on 100 cases (10/33) and 36% on the v2 retest
- `modes.single.baseline_status`: default (measured best on cost: 5/5 at ~17.5k tokens)
- `modes.subagents.baseline_status`: measured 5/5 at ~33k tokens, ~131 s (about 2x tokens, 4x time vs single); use only when lanes are independent
- `modes.swarm.baseline_status`: measured 3/3 at ~87k tokens, ~250 s, ~0.27 weekly pts per case (about 25x single); not a default
- `modes.boost.baseline_status`: measured 2/2 at ~27.5k tokens, ~100 s on easy cases; keep for hard single problems, unmeasured on hard ones
- `modes.teamwork.baseline_status`: proposal only
- `modes.orchestrator_builtin.baseline_status`: measured 5/5 at ~47k tokens, ~110 s (about 2.7x tokens, 3.4x time vs single)
- `modes.lazy_pipeline.baseline_status`: measured 5/5 at ~109k tokens, ~182 s (about 6x tokens); lazyorch variant 5/5 at ~79k tokens

- `baseline_status`: verdict roles measured on 100 common cases (original bench prompt) and, for Argon medium vs high, on 41 hard round-3 cases; implementation measured on easy F13 cases only (every arm 5/5, so the default is chosen on cost); harder multi-file cases unmeasured
- `task_kinds.long_execution.description`: Implementation with tests or long fix-test loops (Hydrogen High measured equal pass rate, faster than Argon)

### 과거 역할별 라우팅 표 (현재 적용 안 함)

Numbers come from our own tests (small samples; re-measure before tightening). Vendor benchmark tables are not used: the Hydrogen column in the table the owner shared contains unofficial cells, so no Hydrogen number here comes from it.

| Role | Model | Evidence | Fallback |
|---|---|---|---|
| Default | Argon medium | 41 hard round-3 cases (carbon-medium-1115): Argon medium 22/41 = Argon high 22/41, identical solved set, median 14 s vs 42 s, output tokens 52k vs 207k (see below) | Argon high |
| Plan, design, final review, security audit | Argon high (security audit also applies the v2 rule) | Accuracy is a tie: Carbon high 62/86 answered (72.1%) vs Argon high 72/99 (72.7%). Carbon is dropped for latency: p50 212 s, p95 526 s, and 14/100 hit the 10-minute cap. A 180 s cap with Argon fallback scores 71/100 against Argon alone 72/100 with twice the calls. Only Carbon high was measured; medium is unmeasured. | - |
| Long context (~250k+ tokens, unmeasured threshold) | Carbon high, cap 600 s | Cap covers Carbon p95 (526 s). The 250k threshold and Argon fallback at that size are assumptions: no case near that size was tested | Argon high on timeout (unverified at this size) |
| Verdict, review, verification | Argon medium | Same 41 cases as Default. Argon high: 72/100 exact on the common 100 cases (medium not run there); Hydrogen high 65/100 with the most clean false alarms (10/33) | Hydrogen xhigh with the v2 prompt |
| Implementation, edits, test runs | Argon high (default); Hydrogen high for long or flaky test-verified execution | All implementation arms passed 5/5 on F13; Argon high was cheapest (see below) | Argon high |
| PII, prompt-injection, docfmt and judgment checks | Argon high or Hydrogen xhigh, v2 prompt required | Two separate measurements: 100-case set with the original prompt (pii 7, inject 8 cases), PII weak for every model, best 3/6 caught; v2 retest (pii 38, inject 32 cases), 70/70 for Argon, Carbon and Hydrogen xhigh, clean false positives 0/24 for xhigh. Hydrogen high had 36% clean false alarms (8/22), so high is never a gate. docfmt scores are partly a bench artifact (binary documents shown as 256-byte hex) | Carbon for a suspect |
| Orchestrator | no role yet | Verdict tasks are answered by Carbon alone (250 s, 10 of 67 failed); implementation comparison pending | - |

Quota rule: Carbon only for long-context input; default and verdicts run on Argon medium, plan, final review, security audit, sensitive checks and implementation on Argon high (medium unmeasured for those), Hydrogen high for long test-verified execution.

Pilot, orchestration style (8 cases F06/F12/F13/F10, n too small to conclude): a split pipeline (Carbon plan, Argon medium implement, Carbon review) passed 6/8 against 4/8 for Flash worker plus Argon verifier. The gap was all F13 code fixes (Flash made no edits, 0/2). The split pipeline took about 2-3x longer. Neither style passed the long Korean report family (F12, 0/2). Four-arm numbers (Swarm, Orchestrator, native, Lazy) follow in the PR discussion.

Caveats:
- `invoke_subagent.Model` documents only `inherit`, `flash` and `flash_lite`; Flash-Lite is not in the Antigravity model table, so the routing table no longer lists it and an exhausted quota means checkpoint and stop. This table sets the session model; explicit model ids as the subagent `Model` are unverified.

## mid 1137 — Neon 기능 및 비용 계약

공식 사실은 이번 소유자 입력을 따른다: LOW/MEDIUM/HIGH/XHIGH; MINIMAL 및 thinking_budget → HTTP 400; 입력+출력 통합 1,048,576 tokens(API 직접 호출 기준); 공유 접두부 ≥4,096 tokens 암시적 캐시; Office/ODF 직접 입력; previous_interaction_id로 gemini-4-hydrogen 인계. 호스트 지원 및 정확도·비용은 [미측정]. 실행 절차는 skills/ulw/SKILL.md의 Neon 실행 계약을 따른다.

## Antigravity 모델 문서 반영 (2026-11-26)

출처: https://antigravity.google/docs/models (2026-11-26 확인).

- Antigravity 안의 Gemini 4 Neon 컨텍스트는 "Up to 512K tokens"다. `long_context.context_policy.unified_limit_tokens`는 524,288이고 1,048,576은 `api_limit_tokens`(API 직접 호출)로만 남긴다. `scripts/long-output.mjs`의 기본 컨텍스트 한도도 524,288이다(설치자 증거가 있으면 최대 1,048,576).
- Gemini 3.8 Flash와 Argon은 2026-11-30에 Antigravity에서 빠지고 Flash-Lite는 모델 표에 없다. `subagent_tiers.flash_lite` 비상 폴백을 지웠다. 쿼터가 바닥나면 다른 모델로 넘기지 않고 체크포인트 후 멈춘다.
- `long_context` 폴백은 Carbon high에서 medium으로 낮췄다. AA-Omniscience 환각률이 medium 4.2%, high 11.4%다(https://ofox.ai/blog/gemini-4-hallucination-rates/, 2차 정리 [일화 수준 근거]). 사실·증거 판정에는 폴백을 쓰지 않고 Neon 청크 처리를 유지한다.

SessionStart는 동적 런타임 상태만 주입한다. rules/AGENTS.md는 호스트 rules 로더가 한 번 주입하고 SKILL.md는 /ulw 호출 시 온디맨드 로더가 읽는다. 해당 로더가 없는 호스트에서는 /ulw를 실행하는 에이전트가 skills/ulw/SKILL.md를 직접 읽어야 한다. 캐시 최소량을 채우려고 규칙이나 스킬을 추가하지 않는다. 호스트 지원과 실제 캐시 적중은 [미측정]이다.

usage 추정 [미측정]: single=1, subagents=3, long_context=4 크기 가중치 × low/medium=1, high=2, xhigh=3 수준 가중치. 점수 1은 light, 2는 medium, 3 이상은 heavy. 대량 건수·파일, 60분 이상 미디어는 크기 가중치 3, 미디어/Office/PDF 형식은 최소 2를 사용한다. 쉼표·밑줄·K/M 토큰 표기를 인식하며 3개 이하 Markdown 오타 수정은 단일 작업으로 취급한다. SessionStart는 payload.task/prompt, 없으면 범위 잠금으로 계산한다. heavy 경고는 정보 제공이며 거부 조건이 아니다. Carbon은 Neon high 청크 처리 실패/불가 후 최후 fallback이고 2026-12-01 가격 2배 안내를 포함한다.

P0–P2 실행 계약: PreInvocation usage_guard는 경고 전용이다. 관측 제한은 회복 관측 전까지 기록하되 훅은 거부하지 않는다. 작업 키는 conversationId와 task의 해시이며 상태는 명시된 작업 폴더의 .lazyneon/runs에 저장한다. 재계획 원장은 resume/payload로 초기화되지 않고 상한은 보고만 한다. 손상 상태는 덮어쓰지 않고 [미확인] 경고를 낸다. executeGate와 long-output은 호스트 어댑터 전용 import API(미연결)다. CLI 수동 절차는 SKILL.md를 따른다.

호스트 쓰기 제한: 기본 24KB/250줄을 유지한다. 플러그인 설치자가 호스트 버전과 제한을 확인한 뒤 훅 프로세스 환경에만 `LAZYNEON_TRUSTED_HOST` JSON을 설정할 수 있다: `{"version":"host-version","evidence":{"source":"installer","version":"host-version","max_write_lines":500}}`. 이 변수는 자동 설정되지 않으며 미설정/잘못된 JSON/버전 불일치는 기본값이다. 설치자는 tool payload에서 환경을 복사하거나 이 변수를 생성하지 않아야 한다. payload.host는 모든 래퍼와 평면 입력에서 무시한다. contextReserve는 입력·사고·도구·출력 여유를 사용한다. 측정이 없으면 대규모 도구 출력·DB 배치·웨이브 종료마다 pin한다.

selfcheck 측정 출처: model/effort/task/verification은 호스트 transcript의 보장 필드가 아닌 선택적인 계측 어댑터 확장이다. verification.before_pass/after_pass와 evidence는 외부 검증기가 제공해야 한다. 필드가 없으면 by_model은 해당 표본을 집계하지 않고 측정 불가 및 unmeasured 수를 표시한다. 문장 수정 휴리스틱은 정확도 향상 증거가 아니다.
