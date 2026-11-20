# LazyNeon (`v0.3.0`)

Gemini 4 Neon용 독립 Google Antigravity 플러그인이다. `/ulw` 실행, 모델 라우팅과 범용 가드를 코어에서 소유한다. MIT 원저작자 표기는 [NOTICE](NOTICE)에 보존한다.

## 설치

이 저장소를 로컬에 받은 뒤 Antigravity의 플러그인 설치 기능에서 저장소 루트를 선택하고 활성화한다. 호스트 버전별 설치 UI/CLI 경로는 [미확인]이다. 설치 후 아래 오프라인 진단으로 파일 배선과 버전을 확인한다.

```sh
LAZYNEON_OFFLINE=1 node scripts/doctor.mjs
```

상태는 `.lazyneon/`, 환경변수는 `LAZYNEON_*`, 피드백 기본 경로는 `~/.lazyneon/feedback`이다. 자동 업데이트는 기본 꺼짐이며 `LAZYNEON_AUTO_UPDATE=1`로 켠다. `LAZYNEON_OFFLINE=1` 또는 `LAZYNEON_NO_AUTO_UPDATE=1`이 켜기 설정보다 우선한다. `LAZYNEON_OFFLINE=1`은 doctor의 live RPC 조회를 막는다. doctor는 `--live`를 줄 때만 실행 중인 Antigravity language server에 접속해 플러그인 로딩 상태를 읽는다(기본은 접속하지 않음).

선택적 동반 플러그인 `lazyneon-workspace`는 도메인 스킬을 별도로 제공한다. 상호 런타임 탐지는 없다. 코어만 `.lazyneon/`과 write_chunk, markdown_structure, json_schema, stop_claim, lookup, post_tool_feedback 가드를 소유한다. 동반 플러그인은 `pins.md`, `ulw-scope.md`를 읽기만 하며 이 파일을 쓰거나 범용 가드를 등록하지 않는다.

라우팅의 단일 기준은 `skills/ulw/references/model-routing.json`이다. Neon이 판단하고 Hydrogen이 수집·구현한다. 호스트가 보고한 Neon 세션이 필요한 티어 이상이면 게이트는 `in_session`, `pending`으로 배정한다. 분류는 검증 PASS가 아니며 실행 근거가 필요하다. Neon high 기준선이며 근거 있는 해당 게이트 승격 시에만 `xhigh 권장, high로 진행`을 안내한다. 미보고 수준은 `[미확인]` 안내 후 진행한다. 비-Neon 세션만 Neon 위임 불가 시 거부한다. SessionStart 보고 모델은 `.lazyneon/session-model.json`에 저장되어 분류 CLI와 공유된다. 호스트 매핑과 모델 성능은 [미측정]이다.

Python 도구 전체를 실행하려면 Python 3.10 이상이 필요하다. doctor는 이전 버전 또는 버전 판독 실패를 경고한다.

### Windows

Node.js 20 이상을 설치한 뒤 PowerShell에서 실행한다. 별도 설치 스크립트 없이 위의 플러그인 설치 절차를 따른다. CLI는 확장자 없는 파일도 Node로 실행할 수 있다.

```powershell
$env:LAZYNEON_OFFLINE = '1'
node bin/lazyneon doctor
npm run test:first
# Python 3.10+ 설치 후 전체 검증
py -3 tools/smoke_test.py
npm test
```

cmd에서는 다음과 같다.

```cmd
set "LAZYNEON_OFFLINE=1"
node bin/lazyneon doctor
```

`test:first`는 Node만으로 분류기·실제 훅·공백 및 한글 경로를 검증한다. 전체 `npm test`는 Python과 플랫폼별 셸 검증도 포함한다. Windows에서는 doctor의 live RPC 진단을 지원하지 않으며 정적 검사만 수행한다.

## Updates

기본값은 알림만 제공하는 방식이다. SessionStart는 main 브랜치에서 origin/main을 최대 24시간에 한 번 확인한다. 원격 ref만 fetch하며 각 Git 호출은 5초 안에 끝낸다. 파일이나 HEAD를 자동으로 바꾸지 않는다. 새 커밋이 있으면 다음 한 줄을 세션에 넣는다.

```text
LazyNeon update available: <old7> → <new7> (N commits). Run: <one-line command>
```

설치 저장소에서 다음 명령을 실행하면 두 버전 사이의 커밋 목록을 보여준 뒤 업데이트한다.

```sh
node bin/lazyneon update
```

로컬 변경이나 미추적 파일이 있으면 거부한다. fast-forward만 허용하므로 로컬 커밋과 원격 이력이 갈라졌을 때도 거부한다. stash, rebase, 강제 덮어쓰기는 하지 않는다. 알림에 나오는 명령에는 설치 경로가 포함되어 있다.

`LAZYNEON_AUTO_UPDATE=1`을 설정하면 기존처럼 깨끗한 main 브랜치를 자동 fast-forward한다. `LAZYNEON_NO_UPDATE_CHECK=1`은 세션의 확인과 자동 갱신을 모두 끈다. 기존 `LAZYNEON_NO_AUTO_UPDATE=1`도 유지된다. `LAZYNEON_OFFLINE=1`은 항상 우선하며 세션 확인과 수동 update도 막는다. 실패한 확인도 24시간 동안 재시도하지 않는다.

출처를 기록하는 보고서에는 `plugin: {version, commit, dirty}`가 들어간다. `scripts/provenance.mjs`의 `pluginProvenance()`로 같은 정보를 얻을 수 있다. commit은 플러그인 저장소의 전체 SHA이며 작업 대상 저장소의 SHA가 아니다. Git 정보가 없는 배포본에서는 commit과 dirty가 null이다.

## 포함 스킬 (26종)

| 스킬 | 설명 |
|---|---|
| `ulw` | `/ulw` 단일 진입점 자율 실행 (3줄 범위 잠금 + 예산, 티어별 병렬 팬아웃, 실측 검증) |
| `ulw-research` | 예산 안에서 병렬 서브에이전트 웨이브로 심층 리서치 및 교차 검증. 고위험 주장은 원문 구절 대조 게이트(`report-tools.mjs claims`)를 통과해야 보고서에 단정형으로 들어감 |
| `programming` | 엄격한 타입, TDD, 단일 파일 250줄 상한 엔지니어링 |
| `debugging` | 가설-반증 기반 런타임 디버깅 |
| `refactor` | 코드 구조 개선 및 안전한 리팩토링 |
| `ast-grep` | 25개 언어 AST 패턴 검색 및 코드모드 재작성 |
| `remove-ai-slops` | AI 코드 슬롭 10종 병렬 제거 |
| `no-comments` | 주석 싫어하는 리뷰어 서브에이전트로 설명·변명 주석 삭제, 땜질 근본 수정 (pstack) |
| `encode-lessons` | 같은 교정이 반복되면 규칙 한 줄 대신 린트·테스트·훅으로 박기, 근본 원인 수정 (pstack) |
| `create-verification-skill` | 저장소별 검증 스킬(.agents/skills/verify) 생성: 앱을 실제로 돌려 증거 남기기 (pstack) |
| `git-master` | 원자적 커밋, 히스토리 분석, rebase/bisect 관리 |
| `coding-agent-sessions` | 멀티 플랫폼 코딩 에이전트 세션 로그 탐색 및 복구 |
| `frontend` | UI/UX/AX 디자인 시스템 레퍼런스와 구현 규칙 |
| `visual-qa` | 스크린샷 기반 시각 QA 및 CJK 조판 점검 (375px 우선) |
| `image-prompt` | 이미지 생성 프롬프트 컴파일러 및 플레이북 |
| `diagram-design` | 39종 브랜드 에디토리얼 다이어그램 디자인 |
| `logo-design` | SVG 로고 및 브랜드 아이덴티티 디자인 (로고 카탈로그 1,400+) |
| `data-scientist` | DuckDB / Polars 상주 커널 기반 데이터 분석 |
| `gf-qa-behavioral-verification` | 런타임 행동 검증, 에러 은폐 패턴 점검, 채택 심사 |
| `gf-qa-computed-outputs` | 수식·파생 지표·참조 링크 무결성 검증 |
| `gf-qa-artifact-consistency` | 산출물·미러 트리·매니페스트 일관성 검증 |
| `hate` | 사용자 호출 전용. 계획의 치명적 반론 하나와 가장 싼 반증 실험 하나만 반환 |
| `shower` | 맥락 없는 새 서브에이전트로 산출물을 콜드 리드해 혼자 읽히는지 점검 (진단만) |
| `factchk` | 그럴듯함·황당함 판단을 외부 출처로 양방향 검증, 출처 없는 수치 단정 금지와 연결 |
| `mandela` | 평가·지표·벤치마크의 자기 채점·누수 8패턴 감사 (읽기 전용) |
| `dedot` | 한국어 가운뎃점(·) 검토, 열린 나열만 쉼표 제안 (제안만, 무단 수정 없음) |

## 훅과 스크립트

| 파일 | 역할 |
|---|---|
| `hooks.json` → `scripts/session_start.mjs` | 세션 시작 시 런타임 블록 주입: 세션 모델(호스트 보고값), 범위 잠금, 가드 팩 버전 |
| `hooks.json` → `scripts/markdown_structure_guard.mjs` | 쓰기 직후 마크다운 구조·사고 블록 누출 검사 (코어 소유) |
| `hooks.json` → `scripts/json_schema_guard.mjs` | JSON 산출물 스키마 검사 |
| `scripts/doctor.mjs` | 읽기 전용 진단: Node/Python, 훅 배선, 스킬 프런트매터, 소스 영수증, 매니페스트 버전 |

## 테스트

```bash
npm test                 # 명시 파일 목록으로 Node 20–25 테스트 실행
node scripts/doctor.mjs  # 또는 npm run doctor
python3 tools/smoke_test.py
```

### 가드와 환경변수

`selfcheck_stats.mjs`는 수동 통계 CLI다. Stop 훅 안의 자기 점검은 기본 활성이고, 완료 근거 검사의 observe 모드와 별도로 Stop 재확인을 요청할 수 있다.

| 변수 | 기본 및 의미 |
|---|---|
| `LAZYNEON_STOP_GUARD` | observe: 완료 근거 판정 기록. enforce: 근거 없는 완료 차단 |
| `LAZYNEON_SELF_CHECK` | on: 위험 주장 재확인. off: 자기 점검 해제 |
| `LAZYNEON_TRUSTED_HOST` | 설치자가 버전·출처·제한을 확인해 훅 환경에 설정하는 JSON. 기본 미설정이며 tool payload에서 복사 금지. [형식](docs/model-routing.md) |
| `LAZYNEON_MAX_WRITE_BYTES` | 24576: 단일 쓰기 바이트 상한 |
| `LAZYNEON_MAX_WRITE_LINES` | 250: 단일 쓰기 줄 상한 |
| `LAZYNEON_DISABLE_WRITE_CHUNK_GUARD` | 1이면 쓰기 크기 가드 해제 |
| `LAZYNEON_FEEDBACK_DIR` | 기본 `~/.lazyneon/feedback`, 사후 검사 큐 경로 |
| `LAZYNEON_LOOKUP_WARN` | 기본 활성, 0이면 조회 실패 경고 해제 |
| `LAZYNEON_LS_RPC_MOCK_JSON` | doctor 테스트용 모의 RPC JSON, 실시간 검증 아님 |
| `LAZYNEON_TEST_SKILL_ROOT` | doctor 테스트용 스킬 루트 |
| `LAZYNEON_OFFLINE` | 1이면 live RPC 및 자동 갱신 금지 |
| `LAZYNEON_NO_UPDATE_CHECK` | 1이면 세션 업데이트 확인과 자동 갱신 금지 |
| `LAZYNEON_AUTO_UPDATE` | 기본 꺼짐, 1이면 자동 갱신 허용 |
| `LAZYNEON_NO_AUTO_UPDATE` | 1이면 자동 갱신 금지, 켜기보다 우선 |

셸 인터프리터의 `-c`/`-e`/`--eval`/`-Command` 인라인 프로그램은 쓰기 여부를 정적으로 증명할 수 없어 전체 명령을 쓰기 크기에 포함한다. 작은 읽기 원라이너는 통과한다.
