# ATTRIBUTION / NOTICE

This skill (`ulw-research`, authored natively for omo-senpi) is authored by
the oh-my-openagent project. Design ideas are adapted from the third-party
projects credited below. No third-party source is vendored here — only ideas
are adapted into this skill's prompt contract.

---

## 1. insane-research (fivetaku) — inspiration for the claim-graph verification gate

The non-code claim-graph verification gate (Phase 4b: a data-flow-lock where the
synthesis may assert a high-risk non-code claim only after it clears `>= 2 independent
source domains + 1 counter-search + a primary source`, otherwise it is abstained to an
unresolved/refuted annex) is inspired by the data-flow-lock verification design in
**insane-research** by fivetaku.

- Source: https://github.com/fivetaku/insane-research
- License: MIT (declared in the project's `README.md`).
- **What is adapted:** the IDEA only — a verification gate whose output is the sole
  allowlist the synthesis draws from, so skipping verification leaves nothing to
  synthesize. No insane-research code is copied or redistributed.
- **Added 2026-11-15 (rules from insane-research v2.9-v2.10, snapshot 8f92b33, 2026-11-03):**
  the mechanical gate in `scripts/claims-gate.mjs` / `claims-cli.mjs` follows its
  `validate_ledger.py` and `verify_report.py` rules: verbatim quotes matched against a
  stored, sha256-pinned page snapshot, the numeric-value rule, independence by
  organization rather than domain, a structured counter-search with registered URLs,
  primary source derived from the source type, two source surfaces, a failed gate that
  deletes the allowlist, the unresolved-ratio warning, and the report check for
  unverified or ghost claim ids. The implementation is our own Node code; no Python
  source was copied.
- **Added 2026-11-16 (insane-search engine, https://github.com/fivetaku/insane-search, MIT,
  commit 82211894339e):** `scripts/fetch-guard.mjs` follows its `engine/safety.py` internal-address
  rules and `engine/content_safety.py` injection signals, made stricter after the design notes of
  the dbc-hbin/muse-discord-gateway Go port (unresolvable hosts fail closed; checked at connect time
  on each redirect hop). That repository has no license, so none of its code is used. The engine
  itself is never bundled: `--allow-bypass` calls a separately installed copy.

```
MIT License

Copyright (c) 2026 renocrypt
```

## 2. latex-paper-skills (yunshenwuchuxun) — citation verification + prose rhythm discipline

The verified-citation contract in `references/latex-report.md` (every bibliography
entry traces 1:1 to a source actually retrieved during the run, and citation
attachment is re-verified after any prose pass) and the citation-preserving rhythm
polish pass (vary sentence and paragraph length, kill filler phrases, minimize
structure-implied transitions, never move a `\cite`) are inspired by the gated
citation-verification workflow and the `latex-rhythm-refiner` skill in
**latex-paper-skills**.

- Source: https://github.com/yunshenwuchuxun/latex-paper-skills (snapshot d0f1061, 2026-03-25)
- License: MIT (Copyright (c) 2026 renocrypt; declared in the project's `LICENSE`).
- **What is adapted:** IDEAS only — no code, templates, or text are copied or
  redistributed. The upstream skills are agent-oriented prompt specs with Python
  validators; this skill translates the concepts into a runtime-agnostic reference
  read by the assembly lane.

## 3. latex-document-skill (ndpvt-web) — compile loop, page previews, scaling, long-form hygiene

The toolchain-detection order (latexmk, then xelatex/pdflatex, then tectonic), the
multi-pass compile loop with log-first debugging and PNG page previews for visual
QA, the empirical page-count scaling rule (1-10 / 11-20 / 21+ pages), the
engine-agnostic preamble pattern (`iftex`; XeLaTeX + fontspec for CJK), the report
template anatomy (geometry/fancyhdr/titlesec/hyperref/booktabs/pgfplots), and the
long-form anti-pattern list in `references/latex-report.md` are inspired by
**latex-document-skill**.

- Source: https://github.com/ndpvt-web/latex-document-skill (snapshot 54279f7, 2026-08-08)
- License: MIT.
- **What is adapted:** IDEAS only — no code, templates, or text are copied or
  redistributed. The upstream compile script and templates are not vendored; the
  reference describes the equivalent loop in plain shell + LaTeX.

## 4. insane-search — ordinary access-method port (0.4.3)

Source: https://github.com/fivetaku/insane-search, MIT, commit
`82211894339e45e7e848c54d47ef4743460bd5df` (`8221189`). Copyright (c) 2026
fivetaku; complete license in `LICENSES/insane-search-MIT.txt` at repository root.
This addition qualifies the earlier ideas-only description: selected signal strings
and route definitions are adapted into new Node code; no Python engine is bundled.

Source paths below are relative to upstream `skills/insane-search/`:

| Source | Adapted destination and scope |
|---|---|
| `engine/phase0.py`, `references/json-api.md`, `public-api.md`, `twitter.md`, `naver.md`, `rss.md`, `media.md` | `references/access-routes.json`, `access-routes.md`, `scripts/access-routes.mjs`: official/public route index, exact host matching, Reddit RSS/JSON, X oEmbed and documented mobile alternate; media/uncertain APIs remain guidance |
| `engine/fetch_chain.py`, `references/fallback.md`, `jina.md`, `playwright.md`, `cache-archive.md`, `metadata.md` | `scripts/access-method.mjs`: ordinary request, validate, official alternate, consent-gated reader, optional ordinary browser, stop and ask for hint; archives are explicit discovery routes, metadata-only pages are not proof of full content |
| `engine/waf_detector.py`, `engine/waf_profiles.yaml`, `engine/validators.py` | `scripts/access-validation.mjs`: status semantics, structural challenge markers, WAF header/cookie evidence, login wall, soft-404, small JSON/empty response distinctions; no vendor ranking or bypass recommendations |
| `engine/url_transforms.py` | `scripts/access-routes.mjs`: deduplicable official alternate concept; no speculative mobile-host grid; caller-confirmed AMP/print URLs are runtime hints only |
| `engine/observations_log.py`, `engine/learning.py` | `scripts/access-method.mjs`: local metadata observations only; learning reviewed but automatic host-route learning intentionally not ported |
| `engine/bias_check.py`, `SKILL.md` | `references/search-craft.md`: No-Site-Name Rule with official route-index exception; reporting diversity and counterevidence checks |
| `engine/content_safety.py`, `engine/safety.py` | Existing `scripts/fetch-guard.mjs` injection/SSRF policy reused; new per-hop consent hook, untrusted-content label; fail-closed DNS and connect-time checks retained |

Excluded: **TLS-fingerprint impersonation**, **header/profile grids aimed at
defeating WAF or bot protection**, and **CAPTCHA solving**. Legal/forensic work
uses documented ordinary access and reports a block with evidence, rather than
trying to defeat access controls. Stealth browsers, automatic dependency installs,
third-party social mirrors and automatic learned bypass ordering are not ported.
The historical optional Python adapter remains a separate legacy feature; the new
access method never invokes it or treats its standing consent as reader consent.
Part 2 additional route families are project-authored guidance, with uncertain
endpoints omitted and external route availability marked `verified: false`.
