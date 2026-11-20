# Access routes — Phase 0

Client/case material: local routes ONLY. Live check on 2026-11-20 with harmless public queries: `verified: true` means the endpoint returned real data that day; keyed routes were confirmed only to answer with an authentication error (endpoint exists, key needed) and stay `verified: false`; the per-route `check.result` in the JSON records what was seen. Availability can change — a past check is not a guarantee. Keys come only from the named environment variables.

The JSON index is authoritative. `{query}`, `{url}`, `{package}`, and `{title}` are encoded public values. Reader `{raw_url}` is a validated public URL. Uncertain endpoints are omitted, not guessed.

| Route | Purpose | Endpoint/tool | Keys | Egress | Never send |
|---|---|---|---|---|---|
| ripgrep | Search client/case material locally | rg over case folders | keyless | none | client/case material, credentials except designated API key to its own provider, private URLs, personal data |
| spotlight | Search client/case material locally | macOS mdfind | keyless | none | client/case material, credentials except designated API key to its own provider, private URLs, personal data |
| document-index | Search client/case material locally | local document text index | keyless | none | client/case material, credentials except designated API key to its own provider, private URLs, personal data |
| embeddings | Search client/case material locally | optional offline embeddings; no hosted model | keyless | none | client/case material, credentials except designated API key to its own provider, private URLs, personal data |
| wayback-availability | Snapshot availability | https://archive.org/wayback/available?url={url} | keyless | third-party | client/case material, credentials except designated API key to its own provider, private URLs, personal data |
| wayback-cdx | Historical captures | https://web.archive.org/cdx/search/cdx?url={url}&output=json | keyless | third-party | client/case material, credentials except designated API key to its own provider, private URLs, personal data |
| archive-today | Read-only existing capture lookup; never submit | https://archive.ph/newest/{url} | keyless | third-party | client/case material, credentials except designated API key to its own provider, private URLs, personal data |
| common-crawl | Discover index collections | https://index.commoncrawl.org/collinfo.json | keyless | third-party | client/case material, credentials except designated API key to its own provider, private URLs, personal data |
| law | 국가법령정보 법령 Open API | law.go.kr Open API; OC registration | OC | public | client/case material, credentials except designated API key to its own provider, private URLs, personal data |
| precedents | 판례 검색 | law.go.kr 판례 Open API; OC registration | OC | public | client/case material, credentials except designated API key to its own provider, private URLs, personal data |
| court-decisions | 대법원 판결서 인터넷열람 | Official court portal; guidance only; comply with login/fees | keyless | public | client/case material, credentials except designated API key to its own provider, private URLs, personal data |
| dart | 공시 검색 | DART OpenAPI | DART_API_KEY | public | client/case material, credentials except designated API key to its own provider, private URLs, personal data |
| kipris | 특허 검색 | KIPRIS Plus API | KIPRIS_API_KEY | public | client/case material, credentials except designated API key to its own provider, private URLs, personal data |
| assembly | 국회 의안정보 | open.assembly.go.kr API | ASSEMBLY_API_KEY | public | client/case material, credentials except designated API key to its own provider, private URLs, personal data |
| kci | 학술 인용 검색 | KCI public portal; guidance only | keyless | public | client/case material, credentials except designated API key to its own provider, private URLs, personal data |
| riss | 학술 자료 검색 | RISS public portal; guidance only | keyless | public | client/case material, credentials except designated API key to its own provider, private URLs, personal data |
| public-data | 공공데이터포털 | data.go.kr dataset-specific API | DATA_GO_KR_API_KEY | public | client/case material, credentials except designated API key to its own provider, private URLs, personal data |
| court-auction | 법원경매정보 | Official court auction portal; guidance only | keyless | public | client/case material, credentials except designated API key to its own provider, private URLs, personal data |
| bigkinds | 뉴스 검색 | BigKinds API | BIGKINDS_API_KEY | public | client/case material, credentials except designated API key to its own provider, private URLs, personal data |
| openalex | Discover papers; follow references backward and citing works forward | https://api.openalex.org/works?search={query} | keyless | public | client/case material, credentials except designated API key to its own provider, private URLs, personal data |
| semantic-scholar | Discover papers; follow references backward and citing works forward | https://api.semanticscholar.org/graph/v1/paper/search?query={query} | SEMANTIC_SCHOLAR_API_KEY | public | client/case material, credentials except designated API key to its own provider, private URLs, personal data |
| crossref | Discover papers; follow references backward and citing works forward | https://api.crossref.org/works?query={query} | keyless | public | client/case material, credentials except designated API key to its own provider, private URLs, personal data |
| arxiv | Discover papers; follow references backward and citing works forward | https://export.arxiv.org/api/query?search_query=all:{query} | keyless | public | client/case material, credentials except designated API key to its own provider, private URLs, personal data |
| pubmed | Discover papers; follow references backward and citing works forward | https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?db=pubmed&term={query}&retmode=json | keyless | public | client/case material, credentials except designated API key to its own provider, private URLs, personal data |
| github | Code and issue search | gh search code / gh search issues (guidance only; do not execute automatically) | GH_TOKEN | public | client/case material, credentials except designated API key to its own provider, private URLs, personal data |
| npm | Package search | https://registry.npmjs.org/-/v1/search?text={query} | keyless | public | client/case material, credentials except designated API key to its own provider, private URLs, personal data |
| pypi | Package metadata | https://pypi.org/pypi/{package}/json | keyless | public | client/case material, credentials except designated API key to its own provider, private URLs, personal data |
| hn-search | Hacker News search | https://hn.algolia.com/api/v1/search?query={query} | keyless | public | client/case material, credentials except designated API key to its own provider, private URLs, personal data |
| stackexchange | Q&A search | https://api.stackexchange.com/2.3/search/advanced?site=stackoverflow&q={query} | keyless | public | client/case material, credentials except designated API key to its own provider, private URLs, personal data |
| reddit-rss | Public posts; JSON may require OAuth; respect rate limits | GET | keyless | public | client/case material, credentials except designated API key to its own provider, private URLs, personal data |
| reddit-json | Public posts; JSON may require OAuth; respect rate limits | GET | keyless | public | client/case material, credentials except designated API key to its own provider, private URLs, personal data |
| youtube | Video search | YouTube Data API search.list | YOUTUBE_API_KEY | public | client/case material, credentials except designated API key to its own provider, private URLs, personal data |
| wikipedia | Page summary | https://en.wikipedia.org/api/rest_v1/page/summary/{title} | keyless | public | client/case material, credentials except designated API key to its own provider, private URLs, personal data |
| wikidata | Structured knowledge | SPARQL query service; guidance only; bounded queries | keyless | public | client/case material, credentials except designated API key to its own provider, private URLs, personal data |
| nominatim | Public place lookup | Nominatim; guidance only: identifying User-Agent, at most 1 req/s, no bulk geocoding | keyless | public | client/case material, credentials except designated API key to its own provider, private URLs, personal data |
| gdelt | Public news and trends | GDELT DOC API; guidance only | keyless | public | client/case material, credentials except designated API key to its own provider, private URLs, personal data |
| google-trends | Public news and trends | Google Trends UI; guidance only | keyless | public | client/case material, credentials except designated API key to its own provider, private URLs, personal data |
| naver-datalab | Public news and trends | Naver DataLab API | NAVER_CLIENT_ID, NAVER_CLIENT_SECRET | public | client/case material, credentials except designated API key to its own provider, private URLs, personal data |
| rdap | Public digital traces; no uploads or scanner submissions | Registry RDAP using IANA bootstrap; preferred over WHOIS | keyless | third-party | client/case material, credentials except designated API key to its own provider, private URLs, personal data, files, client URLs, new scan submissions |
| crt-sh | Public digital traces; no uploads or scanner submissions | crt.sh read-only certificate transparency lookup | keyless | third-party | client/case material, credentials except designated API key to its own provider, private URLs, personal data, files, client URLs, new scan submissions |
| dns | Public digital traces; no uploads or scanner submissions | DNS query; guidance only: resolver receives public domain | keyless | third-party | client/case material, credentials except designated API key to its own provider, private URLs, personal data, files, client URLs, new scan submissions |
| virustotal | Public digital traces; no uploads or scanner submissions | VirusTotal existing hash report only | VIRUSTOTAL_API_KEY | third-party | client/case material, credentials except designated API key to its own provider, private URLs, personal data, files, client URLs, new scan submissions |
| malwarebazaar | Public digital traces; no uploads or scanner submissions | MalwareBazaar existing hash lookup only | MALWAREBAZAAR_API_KEY | third-party | client/case material, credentials except designated API key to its own provider, private URLs, personal data, files, client URLs, new scan submissions |
| naver-search | Public query discovery; verify primary source | Naver Search API: blog/cafe/news/web | NAVER_CLIENT_ID, NAVER_CLIENT_SECRET | third-party | client/case material, credentials except designated API key to its own provider, private URLs, personal data |
| brave | Public query discovery; verify primary source | Brave Search API | BRAVE_SEARCH_API_KEY | third-party | client/case material, credentials except designated API key to its own provider, private URLs, personal data |
| exa | Public query discovery; verify primary source | Exa Search API | EXA_API_KEY | third-party | client/case material, credentials except designated API key to its own provider, private URLs, personal data |
| tavily | Public query discovery; verify primary source | Tavily Search API | TAVILY_API_KEY | third-party | client/case material, credentials except designated API key to its own provider, private URLs, personal data |
| perplexity | Public query discovery; verify primary source | Perplexity Sonar API | PERPLEXITY_API_KEY | third-party | client/case material, credentials except designated API key to its own provider, private URLs, personal data |
| kagi | Public query discovery; verify primary source | Kagi Search API | KAGI_API_KEY | third-party | client/case material, credentials except designated API key to its own provider, private URLs, personal data |
| you | Public query discovery; verify primary source | You.com Search API | YOU_API_KEY | third-party | client/case material, credentials except designated API key to its own provider, private URLs, personal data |
| google-programmable | Public query discovery; verify primary source | Google Programmable Search | GOOGLE_SEARCH_API_KEY, GOOGLE_SEARCH_CX | third-party | client/case material, credentials except designated API key to its own provider, private URLs, personal data |
| searxng | Public query discovery; verify primary source | Self-hosted SearXNG URL from SEARXNG_URL; keyless; guard even self-hosted URLs | keyless | third-party | client/case material, credentials except designated API key to its own provider, private URLs, personal data |
| google-lens | Reverse image search of public images only | google-lens UI; guidance only | keyless | third-party | client/case material, credentials except designated API key to its own provider, private URLs, personal data, client images, private image metadata |
| tineye | Reverse image search of public images only | tineye UI; guidance only | keyless | third-party | client/case material, credentials except designated API key to its own provider, private URLs, personal data, client images, private image metadata |
| yandex-images | Reverse image search of public images only | yandex-images UI; guidance only | keyless | third-party | client/case material, credentials except designated API key to its own provider, private URLs, personal data, client images, private image metadata |
| x-oembed | Public post embed | https://publish.twitter.com/oembed?url={url} | keyless | public | client/case material, credentials except designated API key to its own provider, private URLs, personal data |
| x-syndication | Public timeline / tweet-result | Official syndication reference; guidance only; may truncate | keyless | public | client/case material, credentials except designated API key to its own provider, private URLs, personal data |
| naver-mobile | Official mobile blog view | GET | keyless | public | client/case material, credentials except designated API key to its own provider, private URLs, personal data |
| bluesky | Official/public discovery | AT Protocol public.api.bsky.app; guidance only | keyless | public | client/case material, credentials except designated API key to its own provider, private URLs, personal data |
| mastodon | Official/public discovery | Instance public API; validate chosen instance first | keyless | public | client/case material, credentials except designated API key to its own provider, private URLs, personal data |
| threads | Official/public discovery | Ordinary public page; do not extract unrelated signed media URLs | keyless | public | client/case material, credentials except designated API key to its own provider, private URLs, personal data |
| media | Official/public discovery | yt-dlp metadata guidance only; external CLI is not guard-backed | keyless | public | client/case material, credentials except designated API key to its own provider, private URLs, personal data |
| openlibrary | Official/public discovery | OpenLibrary public JSON API | keyless | public | client/case material, credentials except designated API key to its own provider, private URLs, personal data |
| lobsters | Official/public discovery | Lobste.rs public JSON API | keyless | public | client/case material, credentials except designated API key to its own provider, private URLs, personal data |
| v2ex | Official/public discovery | V2EX public JSON API | keyless | public | client/case material, credentials except designated API key to its own provider, private URLs, personal data |
| devto | Official/public discovery | dev.to public articles API | keyless | public | client/case material, credentials except designated API key to its own provider, private URLs, personal data |
| medium | Official/public discovery | Publisher RSS feed discovery | keyless | public | client/case material, credentials except designated API key to its own provider, private URLs, personal data |
| substack | Official/public discovery | Publisher RSS feed discovery | keyless | public | client/case material, credentials except designated API key to its own provider, private URLs, personal data |
| naver-finance | Official/public discovery | Naver Finance public page; unofficial siseJson API not promoted | keyless | public | client/case material, credentials except designated API key to its own provider, private URLs, personal data |
| jina-reader | Reader fallback; sends public target URL to third party | https://r.jina.ai/{raw_url} | keyless | third-party | client/case material, credentials except designated API key to its own provider, private URLs, personal data |

## Live check 2026-11-20

| Route | Verified | Result |
|---|---|---|
| wayback-availability | yes | live response with real data |
| wayback-cdx | yes | live response with real data |
| archive-today | no | connection failed (no response within 30 s); unreliable from scripts |
| common-crawl | yes | live response with real data |
| law | no | endpoint answers; needs OC plus a registered server IP/domain ("사용자 정보 검증에 실패") |
| precedents | no | same law.go.kr DRF host as law; needs OC plus registered IP/domain |
| court-decisions | no | not called: guidance-only or UI route [미확인] |
| dart | no | endpoint answers; status 010 "unregistered key" without a valid crtfc_key |
| kipris | no | base path returned 404; exact KIPRIS Plus endpoint not confirmed |
| assembly | no | endpoint answers; ERROR-300 without KEY |
| kci | no | not called: guidance-only or UI route [미확인] |
| riss | no | not called: guidance-only or UI route [미확인] |
| public-data | no | apis.data.go.kr answers; per-dataset key required |
| court-auction | no | not called: guidance-only or UI route [미확인] |
| bigkinds | no | endpoint answers; "Blank Access Key" |
| openalex | yes | live response with real data |
| semantic-scholar | no | endpoint answers; keyless requests got HTTP 429 (shared pool) — use the key or back off |
| crossref | yes | live response with real data |
| arxiv | yes | live response with real data |
| pubmed | yes | live response with real data |
| github | yes | live response with real data |
| npm | yes | live response with real data |
| pypi | yes | live response with real data |
| hn-search | yes | live response with real data |
| stackexchange | yes | live response with real data |
| reddit-rss | no | HTTP 404/429 from a non-browser client; Reddit now limits unauthenticated scripted access — treat as unavailable without OAuth |
| reddit-json | no | HTTP 403 from a non-browser client; requires OAuth app access |
| youtube | no | endpoint answers; 403 without key |
| wikipedia | yes | live response with real data |
| wikidata | yes | live response with real data |
| nominatim | yes | live response with real data |
| gdelt | no | endpoint answers; HTTP 429 "one request every 5 seconds" — pace at ≥5 s |
| google-trends | no | not called: guidance-only or UI route [미확인] |
| naver-datalab | no | same openapi.naver.com host as naver-search; key required (not called separately) |
| rdap | yes | live: rdap.org redirects to the registry (verisign for .com); follow redirects |
| crt-sh | yes | live response with real data |
| dns | no | not called: guidance-only or UI route [미확인] |
| virustotal | no | endpoint answers; 401 without key |
| malwarebazaar | no | endpoint answers; 401 — Auth-Key now required |
| naver-search | no | endpoint answers; 401 without client id/secret |
| brave | no | endpoint answers; 422 without subscription token |
| exa | no | POST /search answers; 402 payment required |
| tavily | no | endpoint answers; 401 without key |
| perplexity | no | endpoint answers; 401 without key |
| kagi | no | endpoint answers; 401 without key |
| you | no | not called: guidance-only or UI route [미확인] |
| google-programmable | no | endpoint answers; 403 without key |
| searxng | no | not called: guidance-only or UI route [미확인] |
| google-lens | no | not called: guidance-only or UI route [미확인] |
| tineye | no | not called: guidance-only or UI route [미확인] |
| yandex-images | no | not called: guidance-only or UI route [미확인] |
| x-oembed | yes | live: publish.twitter.com redirects to publish.x.com/oembed |
| x-syndication | no | not called: guidance-only or UI route [미확인] |
| naver-mobile | no | not called: guidance-only or UI route [미확인] |
| bluesky | yes | live response with real data |
| mastodon | yes | live response with real data |
| threads | no | not called: guidance-only or UI route [미확인] |
| media | no | not called: guidance-only or UI route [미확인] |
| openlibrary | yes | live response with real data |
| lobsters | yes | live response with real data |
| v2ex | yes | live response with real data |
| devto | yes | live response with real data |
| medium | no | not called: guidance-only or UI route [미확인] |
| substack | yes | live response with real data |
| naver-finance | no | not called: guidance-only or UI route [미확인] |
| jina-reader | yes | live response with real data |
