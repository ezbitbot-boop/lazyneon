# Core + Workspace hook coexistence

Each plugin registers its own hooks and resolves commands relative to its own
installation root. Neither imports code from its companion. Registration order
is host-dependent: the combined sequence below is the recommended order, and the
simulator checks both plugin orders. Real host event delivery remains unverified.

| Event | Core order | Workspace order | Combined result |
| --- | --- | --- | --- |
| SessionStart | runtime, optional update notice | domain runtime, companion notice | concatenate injectSteps; neither blocks |
| PreToolUse | write_chunk_guard, then destructive_guard (denies drive, home and out-of-workspace wipes; no switch) | evidence_guard pre-tool-use | any deny wins; absence of a decision cannot override deny |
| PostToolUse | markdown/json batch, then lookup batch | domain_feedback batch | persist separate feedback, do not reverse earlier decisions |
| PreInvocation | post_tool_feedback inject, then usage_guard | domain_feedback inject | concatenate notices; retain every refusal |
| Stop | stop_claim_guard, then reply_format_guard | no registered hook | core completion evidence and advisory prose notice |

Core feedback uses `.lazyneon` / LAZYNEON variables; Workspace uses
`.lazyneon-workspace` / LAZYNEON_WS variables. Run only matching entries, in
manifest order within each plugin. Do not use last-result-wins to combine them:
`deny` vetoes a tool call, `continue` at Stop requests more work, and injectSteps
are additive. An empty response means no opinion, never explicit permission.

`test/improve-coexistence.integration.mjs` executes registered commands from both sibling
plugins for harmless input and core-denied oversized writes. The core-only
contract remains usable without Workspace; the separate integration test requires
the companion checkout specified by LAZYNEON_COMPANION_TEST_ROOT or its sibling
folder and reports a missing fixture as a failure, never a silent pass.

Run explicitly: `LAZYNEON_OFFLINE=1 node --test test/improve-coexistence.integration.mjs`.
