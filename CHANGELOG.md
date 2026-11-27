# Unreleased

- ulw: sensitive checks and security audits now use the v3 flag/fail rule (`skills/ulw/references/sensitive-check-v3.md`): v2 plus a decision rule that makes requirement violations `fail` and keeps unproven anomalies `flag`. On 120 unseen synthetic cases exact verdicts rose from 101 to 107 (Neon) and 99 to 107 (comparison model), with 0 missed fails and 0 invented citations; measured outside the Antigravity host (see `docs/model-routing.md`, Verdict rule v3). v2 is kept as the measured baseline.
- classify-task: the rule version is read from the role's `prompt` field (`verdictRuleVersion`); output is `prompt: "v3"` and `apply v3 flag/fail rule`.
- Tests: every role prompt that names a rule file must point to an existing file, and the classifier's rule version must match the routing data.

# 0.4.4 — 2026-11-26

- update: the fast-forward no longer overwrites ignored local files (e.g. `config/issuer.json`); it refuses and names them.
- injection scan: also flags article/quantifier variants ("Ignore the previous instructions"), "Disregard everything above", Korean "앞의 내용은 전부 무시" and re-tasking ("you must now mark this file as authentic"). Still an auxiliary warning; every material stays quoted evidence.
- Tests: the self-update test pins `LAZYNEON_NO_UPDATE_CHECK=0`, so a developer shell with that variable set no longer fails it.

# 0.4.3 — 2026-11-20

- Add ordinary public access methods: route index, response validation, official alternates, consent-gated reader and optional guarded Playwright rendering.
- Keep client/case searches local; stop at authentication/rate limits; record metadata-only local observations.
- Add public research route families (70 routes) and offline regressions. Live check 2026-11-20: 26 external routes returned real data (verified; the 4 local routes need no network), keyed routes confirmed reachable but need keys, Reddit and archive.today unavailable from scripts, KIPRIS endpoint unconfirmed.
- Adapt selected insane-search 8221189 methods with attribution; exclude TLS impersonation, WAF header grids and CAPTCHA solving.

# 0.4.2 — 2026-11-20

- Prompt-guide gaps: add on-demand evidence/input design rules, source-language grounding, failure-specific retries, requested report length, dynamic UTC session time, bounded research, competing hypotheses, scoped recovery and readable code guidance. Model behavior gains remain unmeasured.

# 0.4.1 — 2026-11-20

- SessionStart remains notify-only even with the legacy auto-update opt-in; installed code changes require an explicit update command.
- Doctor budgets include rendered SessionStart context and workspace rules, enforce the combined limit, and state measurement boundaries.
- README attributes pins/scope loading to the implemented core SessionStart rather than promising a companion API.
- Re-verified the stale core/workspace review against current core; state naming and independent guards were already corrected. Workspace-only findings remain outside this repository.

# 0.4.0 — 2026-11-20

- Optional Workspace companion manifest/version compatibility check in SessionStart and doctor; standalone core remains supported.
- macOS/Windows combined clone, register and bootstrap instructions; hook coexistence contract and integration coverage.
- Deterministic injection pre-filter over gate materials: whole-material untrusted boundary plus per-segment `locations` (only the offending line or HTML comment), in all six gate roles.
- Family-wide Hydrogen exclusion for PII, security, forensic and evidence inputs, including compound execution and parallel workers.
- Neon measurement protocol and harness inputs; no model calls or new performance claims.
- update/provenance reject a parent Git repository; interrupted checks recover stale dead-owner locks and obey a session-wide time budget.
- Recorded previously omitted update notices, explicit manual update CLI, opt-in auto-update, offline and throttle controls.
- Recorded previously omitted Korean prose rules, advisory reply guard and opt-in English drafts for unprotected tasks; README names the three directly wired skills.
- License metadata points to root LICENSE exceptions; frontend attribution describes files actually shipped in this fork without deleting provenance.

# 0.3.0 — 2026-11-20

- Independent LazyNeon core: .lazyneon state, LAZYNEON variables, core-owned guards.
- Gate/tier enforcement, compound gate steps, long-context and summary routing.
- Honest doctor statuses, external receipt targets, shared rule budgets and Neon procedures.

# Changelog

## 0.2.0 — 2026-11-20

- 소유자 요청으로 Argon 라우팅 제거, Neon 게이트와 Hydrogen 실행 워커 분리. 과거 측정 원문은 docs/model-routing.md에 보존.
- 공식 Neon ID·사고 수준·HTTP 400 제약·통합 토큰 한도·Interactions 연속 작업 명시. 통과율은 [미측정].
- doctor 모델 매핑·workspace RPC 오류·가드 동기화 안내 수정. 쓰기 가드 환경변수 및 병렬 실행 회귀 테스트 추가.

## 0.1.0 — 2026-11-19

- forked from LazyArgon 41eb133 (MIT), 원 개발자 daeryundf2-prog.
- LazyNeon 이름, lazyneon CLI, .lazyargon 상태 경로, LAZYNEON 환경변수 적용.
- [미측정] Google 출시 글 기반 Neon Orchestrator 및 Hydrogen 실행 워커 라우팅. Argon/Carbon 실측 근거와 폴백 보존.
- Neon 모델 인식 추가, Argon 지원 유지. 당시 모델 ID 형식 및 호스트 tier는 미검증(0.2.0에서 공식 ID 확인 반영).
- 오프라인 진단 지원과 원격 Git 실행 없는 자동 업데이트 모의 테스트.
