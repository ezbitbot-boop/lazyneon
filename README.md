# LazyNeon (`v0.4.4`)

Gemini 4 Neon용 독립 Google Antigravity 플러그인이다. `/ulw` 실행, 모델 라우팅과 범용 가드를 코어에서 소유한다. MIT 원저작자 표기는 [NOTICE](NOTICE)에 보존한다.

포렌식·법률 스킬은 동반 플러그인 [lazyneon-workspace](https://github.com/ezbitbot-boop/lazyneon-workspace)에 있다. 두 플러그인을 함께 설치하는 것을 권한다. 아래 순서는 개발자가 아니어도 따라 할 수 있게 적었다.

## Install both (recommended): 처음 설치하기

### 0. 준비물 세 가지

| 프로그램 | 받는 곳 | 주의 |
|---|---|---|
| Node.js 20 이상 | https://nodejs.org/ 에서 "LTS"라고 적힌 설치 파일 | 설치 마법사의 기본값 그대로 진행한다 |
| Git | Mac: 터미널에서 처음 `git`을 입력하면 뜨는 "명령어 라인 개발자 도구" 설치 창에서 "설치"를 누른다. 창이 안 뜨면 https://git-scm.com/downloads <br>Windows: https://git-scm.com/download/win | Windows 설치 마법사는 기본값 그대로 둔다 |
| Python 3.12 | https://www.python.org/downloads/ 에서 3.12 버전(3.12.x) 설치 파일 | Windows 설치 첫 화면에서 **"Add python.exe to PATH"를 체크**한다 |

설치가 끝나면 터미널(Mac: "터미널" 앱, Windows: 시작 메뉴의 "PowerShell")을 **새로 열고** 버전을 확인한다.

```sh
node --version      # v20 이상이면 된다 (예: v22.11.0)
git --version       # 숫자가 나오면 된다
python3 --version   # Mac. Python 3.12 이상이면 된다
```

```powershell
py -3.12 --version  # Windows. "Python 3.12.x"가 나오면 된다
```

Python은 3.12로 통일한다(동반 플러그인이 3.12 이상을 요구하고, doctor도 3.12 미만이면 경고한다). Mac에서 `python3 --version`이 3.12보다 낮으면 python.org에서 3.12를 설치한다. 아래 1단계의 `python3.12` 명령이 "command not found"로 실패하면 `python3 --version`을 다시 확인하고, 3.12 이상(예: 3.13)이면 `python3.12` 대신 `python3`을 쓴다. Windows에서 `py -3.12`가 "No suitable Python runtime found"로 실패하면 3.12를 설치하거나, `py --list`에 보이는 3.12 이상 버전 번호로 바꿔 쓴다(예: `py -3.13`).

### 1. 내려받기: ZIP이 아니라 git clone

GitHub의 "Download ZIP"으로 받지 않는다. ZIP으로 받은 폴더는 Git 저장소가 아니어서 업데이트 알림이 영원히 뜨지 않고 `node bin/lazyneon update`도 실패한다. GitHub 계정은 필요 없다.

**두 저장소는 반드시 같은 상위 폴더 안에 둔다.** 코어는 옆 폴더에서 동반 플러그인을 찾는다(폴더 이름은 달라도 되지만 위치는 형제 폴더여야 한다). 아래 명령은 둘 다 `Plugins` 폴더에 넣는다.

macOS (터미널):

```sh
mkdir -p "$HOME/Plugins"
cd "$HOME/Plugins"
git clone https://github.com/ezbitbot-boop/lazyneon.git lazyneon
git clone https://github.com/ezbitbot-boop/lazyneon-workspace.git lazyneon-workspace
cd lazyneon-workspace
python3.12 scripts/setup_forensic_env.py
cd ../lazyneon
LAZYNEON_OFFLINE=1 node bin/lazyneon doctor
```

Windows (PowerShell):

```powershell
New-Item -ItemType Directory -Force "$env:USERPROFILE/Plugins"
Set-Location "$env:USERPROFILE/Plugins"
git clone https://github.com/ezbitbot-boop/lazyneon.git lazyneon
git clone https://github.com/ezbitbot-boop/lazyneon-workspace.git lazyneon-workspace
Set-Location lazyneon-workspace
py -3.12 scripts/setup_forensic_env.py
Set-Location ../lazyneon
$env:LAZYNEON_OFFLINE = '1'
node bin/lazyneon doctor
```

cmd에서는 마지막 두 줄 대신 다음을 쓴다.

```cmd
set "LAZYNEON_OFFLINE=1"
node bin/lazyneon doctor
```

마지막 줄은 진단(doctor)이다. 맨 끝에 `FAIL 0개`가 나오면 파일 배치는 정상이다. `[warn]` 줄은 읽어 보고, 이해가 안 되면 그 줄을 그대로 복사해 물어본다. `config` 줄은 아래 설정 파일의 현재 값을 보여 준다.

### 2. Antigravity에 등록하기 ([미확인])

Antigravity의 로컬 플러그인 설치 기능에서 `Plugins/lazyneon` 폴더를 선택해 켜고, 같은 방법으로 `Plugins/lazyneon-workspace`도 따로 등록해 켠다. **이 단계는 아직 실제 설치 화면으로 확인하지 못했다.** 호스트 버전별 메뉴 이름과 위치, 등록용 CLI 명령은 [미확인]이며 문서화되지 않은 명령은 적지 않는다. 첫 실기 설치 때 화면을 기록해 이 절을 채운다.

훅은 `node ./scripts/…`로 실행되므로 Antigravity 앱이 `node`를 찾을 수 있어야 한다. 앱이 터미널과 같은 PATH를 쓰는지는 [미확인]이다. 아래 성공 확인이 안 되면 Antigravity를 완전히 종료했다가 다시 연다.

### 3. 성공 확인

새 대화를 시작하면 첫 시스템 메시지에 다음과 비슷한 블록이 들어간다(경로·시각·commit은 사람마다 다르다). 이 블록이 보이면 코어 등록과 훅 실행이 된 것이다. `Companion lazyneon-workspace` 줄이 있으면 동반 플러그인도 찾은 것이다.

```text
## LazyNeon 런타임
Companion lazyneon-workspace "0.2.2": compatible (requires >=0.1.0, optional)

플러그인: lazyneon 0.4.4 / commit 1a2b3c… / 가드 팩 1.1.0
플러그인 경로: /Users/<이름>/Plugins/lazyneon
워크스페이스: /Users/<이름>/cases/case-2026-001
세션 모델: gemini-4-neon-high
…
### 범위 잠금 (.lazyneon/ulw-scope.md)
```

`세션 모델: unknown`이면 호스트가 모델을 알려 주지 않은 것이다. 모델 선택기에서 Gemini 4 Neon을 직접 고른다(Orchestrator가 아니라). 개인정보·증거·포렌식 판정 작업은 Neon 단독 세션에서만 진행되고, 다른 모델이나 Orchestrator 세션이면 LazyNeon이 진행을 거부하고 Neon으로 바꾸라고 안내한다.

## 막혔을 때

대부분의 탈출구는 **설정 파일 한 줄**로 켜고 끈다. 환경변수를 몰라도 된다.

### 설정 파일 만들기

플러그인 폴더의 `config/local.example.json`을 같은 폴더에 `local.json`이라는 이름으로 복사한 뒤 연다. 이미 `local.json`이 있으면 복사하지 말고 바로 연다.

macOS (터미널):

```sh
cp -n ~/Plugins/lazyneon/config/local.example.json ~/Plugins/lazyneon/config/local.json
open -e ~/Plugins/lazyneon/config/local.json
```

Windows (PowerShell):

```powershell
$cfg = "$env:USERPROFILE\Plugins\lazyneon\config"
if (-not (Test-Path "$cfg\local.json")) { Copy-Item "$cfg\local.example.json" "$cfg\local.json" }
notepad "$cfg\local.json"
```

파일 안에서는 `true`(켜짐)와 `false`(꺼짐)만 바꾸고 따옴표와 쉼표는 건드리지 않는다. 저장하면 가드와 자기 점검은 다음 동작부터, 업데이트 확인은 다음 대화부터 적용된다. 메모장(UTF-8, UTF-8 BOM, 유니코드 저장 모두)과 텍스트편집기 저장을 읽는다. 파일이 깨졌으면 기본값으로 동작하고 doctor의 `config` 줄과 세션 시작 블록에 문제를 알려 준다.

| 항목 | 기본 | `false`/`true`로 바꾸면 | 같은 뜻의 환경변수 |
|---|---|---|---|
| `writeChunkGuard` | `true` | `false`: 한 번에 큰 파일 쓰기(250줄·24KB 초과) 차단을 끈다 | `LAZYNEON_DISABLE_WRITE_CHUNK_GUARD=1` |
| `selfCheck` | `true` | `false`: 답변 자기 점검(추가 턴)을 끈다 | `LAZYNEON_SELF_CHECK=off` |
| `offline` | `false` | `true`: 코어의 업데이트 확인·수동 update·웹 조회 스킬·doctor 실시간 검사를 끈다 | `LAZYNEON_OFFLINE=1` |
| `updateCheck` | `true` | `false`: 하루 한 번 GitHub 업데이트 확인을 끈다 | `LAZYNEON_NO_UPDATE_CHECK=1` |

우선순위는 **환경변수 > 설정 파일 > 기본값**이다. 환경변수를 설정해 두었다면 파일보다 그 값이 이긴다. 다른 위치의 파일을 쓰려면 `LAZYNEON_CONFIG`에 경로를 준다. `config/local.json`은 Git이 무시하는 파일이라 업데이트로 덮어써지지 않는다.

설정 파일로 끌 수 있는 것은 위 네 가지뿐이다. 증거·비밀·출처 관련 가드와 아래 삭제 방지 가드는 일부러 끌 수 없게 했다. 다른 항목을 적으면 무시하고 doctor에 경고로 표시한다.

### 증상별 해결

| 증상 | 원인 | 해결 |
|---|---|---|
| `[WRITE CHUNK GUARD] BLOCKED` | 한 번에 너무 큰 파일 쓰기(호스트 60초 무응답 끊김 방지) | AI에게 "100줄씩 나눠서 써 줘"라고 한다. 계속 막히면 `writeChunkGuard`를 `false`로 |
| `[DESTRUCTIVE GUARD] BLOCKED` | 드라이브 루트·홈 폴더·작업 폴더 밖을 통째로 지우는 명령 | 끌 수 없다. 꼭 지워야 하면 Finder/탐색기에서 직접 지우거나, 작업 폴더 안의 대상을 이름으로 지정하게 한다 |
| 답이 끝난 뒤 "[SELF-CHECK]"로 한두 번 더 확인함, 쿼터가 빨리 줄어듦 | 자기 점검 (아래 "자기 점검의 추가 턴과 비용") | `selfCheck`를 `false`로 |
| 인터넷 없는 PC, 또는 사건 PC에서 외부 접속을 전혀 원하지 않음 | 업데이트 확인(GitHub)·웹 조회 스킬 | `offline`을 `true`로 |
| 매번 업데이트 안내가 거슬림 | 하루 한 번 업데이트 확인 | `updateCheck`를 `false`로. 업데이트는 `node bin/lazyneon update`로 직접 한다 |
| "switch the model picker to Gemini 4 Neon" 또는 "sensitive task needs a direct Gemini 4 Neon session" | Neon이 필요한 작업인데 세션이 다른 모델이거나 Orchestrator | 모델 선택기에서 Gemini 4 Neon을 고르고 새 대화를 연다 |
| `Evidence`라는 폴더 안에서 파일 쓰기가 전부 막힘 | 동반 플러그인의 증거 보호 가드 | 동반 플러그인 쪽 문제다. lazyneon-workspace를 최신으로 업데이트한다. 이 가드는 설정 파일로 끌 수 없다 |
| 세션 시작 블록이 안 보임 | 등록 실패 또는 앱이 `node`를 못 찾음 | 위 1단계의 doctor를 다시 실행하고 Antigravity를 완전히 껐다 켠다. 그래도 안 되면 [미확인] 영역이므로 화면을 캡처해 문의한다 |

환경변수를 꼭 써야 한다면: Mac에서 Dock으로 켠 앱은 터미널의 `export` 값을 보지 못한다(`launchctl setenv 이름 값` 후 앱 재시작). Windows는 `setx 이름 값` 후 앱을 다시 연다. 설정 파일이 더 쉽다.

## 무엇이 어디에 기록되나 (포렌식 사용자 안내)

사건 내용을 인터넷으로 보내는 기본 경로는 없다. 다만 다음 기록이 남는다. **증거 원본 폴더 자체를 작업 폴더로 열지 않는다.** 작업 폴더 안에 `.lazyneon/` 폴더가 생기기 때문이다.

| 무엇 | 어디에 | 사건 내용 |
|---|---|---|
| 완료 선언·자기 점검 판정 | 작업 폴더 `.lazyneon/stop-guard.jsonl` | 답변 원문은 남기지 않는다. 답변과 점검 문장의 sha256 해시와 길이, 판정 이유만 적는다 |
| 실패한 조회 명령(160자) | 작업 폴더 `.lazyneon/lookups.jsonl` | 경로·검색어가 들어갈 수 있다 |
| 작업 문장·실행 상태, 세션 모델 | 작업 폴더 `.lazyneon/runs/`, `session-model.json` | 작업 지시문이 들어갈 수 있다 |
| 사후 검사 대기열 | `~/.lazyneon/feedback/` | 가드 이름과 오류 ID만, 다음 턴에 지운다 |
| 업데이트 확인 | GitHub (24시간에 1번) | 보내지 않는다. `offline`으로 끌 수 있다 |

작업 폴더를 알 수 없을 때(호스트가 절대 경로를 주지 않을 때)는 기록을 홈 폴더로 대신 쓰지 않고 아예 남기지 않는다.

## 자기 점검의 추가 턴과 비용

Stop 단계의 자기 점검은 기본으로 켜져 있다. 최종 답변에 근거 확인이 필요해 보이는 문장(예: "전부", "모두", 출처 없는 수치, 조회 실패 뒤의 "없다")이 있으면 답을 끝내지 않고 AI에게 그 문장만 도구 결과와 다시 대조하게 한다(`scripts/stop_claim_guard.mjs`). 한 요청에 **최대 2번** 추가 턴이 생기고 그만큼 사용량(쿼터)이 늘어난다. 실제 증가량은 측정하지 않았다 [미측정]. 같은 종류의 문장은 한 요청에서 다시 묻지 않는다. 끄려면 설정 파일에서 `selfCheck`를 `false`로 둔다. 끄면 확인 없이 답이 바로 나간다. 완료 근거 검사(`LAZYNEON_STOP_GUARD`)는 이와 별개이며 기본은 observe(기록만)다.

## 구성

상태는 `.lazyneon/`, 설정은 `config/local.json`, 환경변수는 `LAZYNEON_*`, 피드백 기본 경로는 `~/.lazyneon/feedback`이다. SessionStart는 업데이트를 안내만 하며 설치 코드를 변경하지 않는다. 갱신은 `node bin/lazyneon update`로 명시적으로 실행한다. `LAZYNEON_OFFLINE=1` 또는 `LAZYNEON_NO_AUTO_UPDATE=1`이 켜기 설정보다 우선한다. `LAZYNEON_OFFLINE=1`은 doctor의 live RPC 조회를 막는다. doctor는 `--live`를 줄 때만 실행 중인 Antigravity language server에 접속해 플러그인 로딩 상태를 읽는다(기본은 접속하지 않음).

선택적 동반 플러그인 `lazyneon-workspace`는 도메인 스킬을 별도로 제공한다. SessionStart와 doctor는 형제 폴더의 plugin.json 이름·버전으로 선택적 companion(>=0.1.0)을 읽기 전용 검사한다. 설치되어 있으면 호환성을 알리며, 없으면 doctor에만 forensic/legal skills not installed를 표시한다. 실패해도 세션을 차단하지 않는다. 코어만 `.lazyneon/`과 write_chunk, destructive, markdown_structure, json_schema, stop_claim, lookup, post_tool_feedback 가드를 소유한다. 코어 SessionStart가 `pins.md`, `ulw-scope.md`를 읽어 런타임 문맥에 주입한다. 동반 플러그인의 별도 파일 읽기 API를 약속하지 않는다. Core declares optional companion >=0.1.0; the supported pairing requires core >=0.3.0. Their version numbers need not match. See [hook order](docs/hook-coexistence.md) and [measurement protocol](docs/measurement.md).

라우팅의 단일 기준은 `skills/ulw/references/model-routing.json`이다. Neon이 판단하고 일반 작업의 Hydrogen 워커(`flash`)가 수집·구현한다. 서브에이전트 `pro`는 이름과 달리 Hydrogen XHigh로 실행되므로(antigravity-cli #1824, #1710) Neon 판단은 서브에이전트로 넘기지 않고 Neon 세션이 직접 한다. 비-Neon 세션에서 Neon이 필요한 단계는 위임하지 않고 거부하며 모델 선택기에서 Gemini 4 Neon을 고르라고 안내한다. PII·민감정보·보안 감사·포렌식 판정·증거 자료가 있는 작업은 `delegation: "forbidden"`으로, 서브에이전트와 Orchestrator 없이 모든 단계를 Neon 단독 세션에서 처리한다. 호스트가 보고한 Neon 세션이 필요한 티어 이상이면 게이트는 `in_session`, `pending`으로 배정한다. 분류는 검증 PASS가 아니며 실행 근거가 필요하다. Neon high 기준선이며 근거 있는 해당 게이트 승격 시에만 `xhigh 권장, high로 진행`을 안내한다. 미보고 수준은 `[미확인]` 안내 후 진행한다. SessionStart 보고 모델은 `.lazyneon/session-model.json`에 저장되어 분류 CLI와 공유된다. Antigravity 안의 Neon 컨텍스트는 최대 512K 토큰이다([모델 문서](https://antigravity.google/docs/models)). 호스트 매핑과 모델 성능은 [미측정]이다.

## Updates

기본값은 알림만 제공하는 방식이다. SessionStart는 main 브랜치에서 origin/main을 최대 24시간에 한 번 확인한다. 원격 ref만 fetch하며 각 Git 호출은 5초, 세션 확인 전체는 12초 예산 안에 끝낸다. Git 최상위 경로와 플러그인 실제 경로가 다르면 확인·갱신을 거부한다. 잠금은 PID·생성시각을 기록하며 60초 이상 지난 죽은 소유자의 잠금만 회수한다. 파일이나 HEAD를 자동으로 바꾸지 않는다. 새 커밋이 있으면 다음 한 줄을 세션에 넣는다.

```text
LazyNeon update available: <old7> → <new7> (N commits). Run: <one-line command>
```

설치 저장소에서 다음 명령을 실행하면 두 버전 사이의 커밋 목록을 보여준 뒤 업데이트한다(Mac 터미널, Windows PowerShell 모두 같다). ZIP으로 받은 폴더에서는 동작하지 않는다.

```sh
node bin/lazyneon update
```

로컬 변경이나 미추적 파일이 있으면 거부한다. 갱신이 무시된(.gitignore) 로컬 파일을 덮어써야 하면 그 파일을 알리고 거부한다. fast-forward만 허용하므로 로컬 커밋과 원격 이력이 갈라졌을 때도 거부한다. stash, rebase, 강제 덮어쓰기는 하지 않는다. 알림에 나오는 명령에는 설치 경로가 포함되어 있다. `config/local.json`은 Git이 무시하는 파일이라 업데이트에 영향을 주지 않는다.

SessionStart는 `LAZYNEON_AUTO_UPDATE=1`이 있어도 안내만 한다. 이 변수는 기존 `autoUpdate()` 직접 호출의 호환 옵션이며 세션 훅에서는 무시한다. `LAZYNEON_NO_UPDATE_CHECK=1`(또는 설정 파일 `"updateCheck": false`)은 세션의 확인과 자동 갱신을 모두 끈다. 기존 `LAZYNEON_NO_AUTO_UPDATE=1`도 유지된다. `LAZYNEON_OFFLINE=1`(또는 `"offline": true`)은 항상 우선하며 세션 확인과 수동 update도 막는다. 실패한 확인도 24시간 동안 재시도하지 않는다.

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

`hooks.json`에 등록된 훅 전체다(9개). "막음"은 도구 실행이나 답변 종료를 멈추는 것, "경고"는 다음 턴에 안내만 붙이는 것이다.

| 시점 | 실행 | 하는 일 | 막나? | 끄는 법 |
|---|---|---|---|---|
| SessionStart | `scripts/session_start.mjs` | 런타임 블록 주입(세션 모델, 플러그인 경로, 범위 잠금, 고정 식별자, 설정 파일 상태), 하루 한 번 업데이트 안내 | 아니오 | 업데이트 안내만 `updateCheck`/`offline` |
| PreToolUse (모든 도구) | `scripts/write_chunk_guard.mjs` | 한 번에 250줄·24KB 넘는 쓰기 차단. 페이로드 모양을 모르거나 검사 오류면 경고만 하고 통과 | 막음(크기 초과만) | `writeChunkGuard` |
| PreToolUse (모든 도구) | `scripts/destructive_guard.mjs` | 드라이브 루트·홈 폴더·작업 폴더 밖을 지우는 `rm -rf`, `Remove-Item -Recurse -Force`, `rd /s`, `del /s`, `format`, `diskpart` 차단. 판단이 안 되면 차단 | 막음 | 끌 수 없음 |
| PostToolUse (모든 도구) | `scripts/post_tool_feedback.mjs batch` → `markdown_structure_guard.mjs`, `json_schema_guard.mjs` | 쓰기 직후 마크다운 구조·사고 블록 누출, JSON 스키마 검사 | 경고 | — |
| PostToolUse (읽기·검색·셸) | `scripts/post_tool_feedback.mjs batch` → `lookup_guard.mjs` | 실패하거나 0건인 조회를 "없다"로 넓히지 않게 경고 | 경고 | `LAZYNEON_LOOKUP_WARN=0` |
| Stop | `scripts/stop_claim_guard.mjs` | 근거 없는 완료 선언 기록(observe), 위험한 문장 자기 점검(최대 2번 추가 턴) | 자기 점검만 | `selfCheck` |
| Stop | `scripts/reply_format_guard.mjs` | 한국어 답변 상투어·장식 점검 | 경고 | `LAZYNEON_REPLY_GUARD=off` |
| PreInvocation | `scripts/post_tool_feedback.mjs inject` | 위 PostToolUse 경고를 다음 모델 호출 앞에 붙임 | 아니오 | — |
| PreInvocation | `scripts/usage_guard.mjs` | 사용량·재계획 상한 경고와 체크포인트 | 경고 | — |

`scripts/doctor.mjs`는 읽기 전용 진단이다: Node/Python, 설정 파일, 훅 배선, 스킬 프런트매터, 소스 영수증, 매니페스트 버전.

## 테스트

```bash
npm run test:first       # Node만으로 분류기·실제 훅·공백 및 한글 경로 검증
npm test                 # 명시 파일 목록으로 Node 20–25 테스트 실행 (Python 3.12와 플랫폼별 셸 검증 포함)
node scripts/doctor.mjs  # 또는 npm run doctor
python3 tools/smoke_test.py   # Windows: py -3.12 tools/smoke_test.py
```

Windows에서는 doctor의 live RPC 진단을 지원하지 않으며 정적 검사만 수행한다.

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
| `LAZYNEON_AUTO_UPDATE` | 기존 `autoUpdate()` 직접 호출 전용; SessionStart에서는 무시 |
| `LAZYNEON_NO_AUTO_UPDATE` | 1이면 자동 갱신 금지, 켜기보다 우선 |
| `LAZYNEON_CONFIG` | 설정 파일 경로. 기본 `config/local.json`(플러그인 폴더) |

셸 인터프리터의 `-c`/`-e`/`--eval`/`-Command` 인라인 프로그램은 쓰기 여부를 정적으로 증명할 수 없어 전체 명령을 쓰기 크기에 포함한다. 작은 읽기 원라이너는 통과한다.

## 한국어 작성과 선택적 영어 초안

`ulw`, `programming`, `remove-ai-slops`는 한국어 산문을 만들 때 `rules/korean/`의 동사·문장 부호·자연스러운 산문 규칙을 필요할 때만 읽는다. `rules/AGENTS.md`에는 한 줄 경로만 추가하며 SessionStart에 본문을 주입하지 않는다. 각 파일은 8,000B 이하이고 문장 부호 문서에 국립국어원 출처를 적었다. 규칙과 예문은 이 저장소에서 직접 작성했다.

Stop의 `scripts/reply_format_guard.mjs`는 한국어 최종 답변의 상투어, 연결어미 뒤 쉼표, 장식 이모지, 샌드위치 도입·마무리, 파일 산출 후 마지막 사용 안내를 점검한다. 코드 블록·코드 구간과 비한국어 답변은 제외한다. 최대 세 문제를 `injectSteps[].ephemeralMessage` 한 개에 담으며 종료를 차단하거나 경고를 파일에 저장하지 않는다. `LAZYNEON_REPLY_GUARD=off`로 끈다. 호스트가 Stop의 일회성 메모를 표시하는지는 별도 실기 확인이 필요하다. 파일 산출은 `produced_files` 배열 또는 현재 사용자 턴의 쓰기 도구 호출로 추정한다. 셸 내부의 임의 파일 쓰기는 판별하지 못한다.

`LAZYNEON_REASONING_LANG=en`은 일반 글쓰기·코딩(`general`, `implementation`, `long_execution`)에만 영어로 사고·초안을 구성한 뒤 자연스러운 한국어로 작성하라는 지침을 켠다. 기본은 꺼짐이며 `classify-task`는 `reasoning_language: "ko"`를 반환한다. 활성화하면 `"en"`과 해당 지침을 `rules`에 추가한다. 이는 모델 내부 사고 언어를 측정하거나 강제한다는 뜻이 아니다.

법률, 포렌식, 민감정보/PII, `security_audit`, `final_review`, 증거 관련 작업(검증·집계·전사 포함)은 한국어를 유지한다. 주된 종류가 코딩이어도 보호 대상 신호가 함께 있으면 `ko`가 우선한다. 번역 과정에서 법률 용어의 범위나 증거 문장의 의미가 달라질 수 있기 때문이다. 새로운 종류와 미분류 작업에는 영어 지침을 자동 확대하지 않는다. 키워드 분류가 맥락을 놓치면 스킬에서 한국어로 전환하며 원문 인용은 보존한다.
