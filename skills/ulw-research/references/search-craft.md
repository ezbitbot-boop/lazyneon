# ulw-research — search craft

검색 언어는 원문 출처에 맞춘다. 국제 기술·API 자료는 영어를 기본으로 하고, 한국 법령·판례·국내 사건은 한국어 공식 명칭과 원문을 먼저 조회한다. 필요한 경우 다른 언어·동의어로 보완하며 직접 인용은 원문 언어를 유지한다.

## 공통 근거 탐색

이 절은 일반 조사에도 적용한다. 심층 연구의 팀·원장·웨이브 의무를 자동 활성화하지 않는다.

- 먼저 질문의 대상·버전·기준 시점과 필요한 답의 범위를 정한다.
- 로컬 자료로 답하더라도 최신·희귀 사실은 자료의 작성·갱신 시점이 질문을 충족하는지 확인한다.
- 최신 사실이 필요하면 실제 현재 날짜·연도를 검색어와 기간 조건에 반영한다. 과거 시점 질문에는 그 시점을 사용한다.
- 사용 가능한 검색·원문 조회 도구를 확인한다. Google Search grounding이 실제로 지원되면 활용하고, 일반 웹 검색을 수행한 것을 native grounding 활성화로 보고하지 않는다.
- 중요한 검색 결과는 본문을 열어 관련 구절·출처·기준일을 확인한다. 검색 실패·본문 미확보는 부존재 증명이 아니다.
- 자료 한정 답변과 외부 조사 허용 답변을 구분한다. 사용자 지정 자료 밖 검색이나 민감 자료 외부 전송 권한을 이 절이 새로 부여하지 않는다.
- 검색 결과가 기존 가정을 반박하면 질문·가설·검색 경로를 갱신한다. 반복 검색 횟수 자체를 완전성 근거로 삼지 않는다.
- 심층 연구에서는 기존 claim graph·source ledger·counter-search·유효 시각 필드를 재사용한다.

Vary operators on every query — same query twice wastes a worker:

| Operator | Example | Use |
|---|---|---|
| `site:` | `site:github.com <topic>` | Restrict to a domain |
| `filetype:` | `filetype:pdf <topic> survey` | Papers, specs |
| `intitle:` / `inurl:` | `intitle:benchmark <topic>` | Targeted pages |
| `"exact"` / `-term` | `"<exact phrase>" -tutorial` | Precision, exclusion |
| `OR` | `<a> OR <b> <topic>` | Coverage |
| `before:` / `after:` | `<topic> after:2025-06-01` | Recency control |

High-yield combinations: official docs (`site:<docs domain>`), GitHub implementations (`site:github.com`), recent discussion (`site:reddit.com OR site:news.ycombinator.com after:<date>`), academic (`site:arxiv.org OR filetype:pdf survey`), changelog hunting (`changelog OR "release notes" <version>`), alternatives (`vs OR alternative OR comparison`).

X/social searches are unavailable in this runtime — substitute `site:x.com`/`site:twitter.com` web queries and indexed coverage (see the X/social role protocol in SKILL.md).
