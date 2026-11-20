# Neon measurement readiness

No model runs were performed for 0.4.0. All Neon pass rates, latency, token costs,
and routing comparisons remain [미측정]. Historical Argon measurements in
`docs/model-routing.md` are provenance, not Neon measurements.

Use the same old dummy/bench inputs, oracle and scoring rules for paired runs:

- `DUMMY_SET=<private synthetic fixture directory>`
- `BENCH_SET=<private benchmark directory>`
- `BASELINE_RESULTS=<historical Argon result file>`
- `OUTPUT_DIR=<private measurement output directory>`

Locate the original sets and record their content hashes before running; these are
placeholders, not bundled datasets. Do not publish real evidence or PII. Keep the
case list and denominator fixed, including failed and unavailable runs. Record
case ID, fixture SHA256, rubric version, prompt hash, actual model ID/tier,
host version, seed (if supported), outcome, verifier evidence, input/output/cache
and thinking tokens if reported, wall time, tool calls, retries and errors.
Unavailable counters remain null, not zero.

Put Neon high in each old Argon orchestration/gate seat. Keep prompts, tools,
timeouts and independent grading fixed. Compare Neon workers against historical
Argon workers on the same cases separately; never assign protected material to
Hydrogen. An xhigh promotion is a separate arm with its recorded trigger, not a
silent retry. Use `executeGate` with a host adapter and scanned `materials`; use
`classifyTask` for the intended schedule and record the actually executed model.
The offline regression suite validates these interfaces without model calls.

Report paired case-level pass/fail differences and confidence intervals, gate
false accept/reject rates, injection attack success rate, PII recall/precision,
unavailable rate, median/p95 latency, tokens and measured billed cost. Separate
security/PII, forensic, coding and mechanical strata; publish per-stratum sample
sizes. Missing cost data must not become inferred savings.

30-case results cannot support a conclusion. Pre-register adequate sample sizes
and detectable differences, randomize run order, use independent blinded grading,
and retain every receipt. Do not select a faster/cheaper arm at lower pass rate.
Until measurements exist, retain [미측정] on every Neon routing number and do not
transfer historical Argon success rates to Neon.
