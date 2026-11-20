import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { liveRpcCheck } from "../scripts/doctor.mjs";

import { RULES_FILE_WARN_BYTES, RULES_TOTAL_WARN_BYTES } from "../scripts/rules-budget.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("#given repo #when doctor --json runs #then every structural check is ok and exit is 0", () => {
	const res = spawnSync("node", [path.join(ROOT, "scripts", "doctor.mjs"), "--json"], { cwd: ROOT, encoding: "utf8" });
	assert.equal(res.status, 0, res.stdout + res.stderr);
	const data = JSON.parse(res.stdout);
	assert.equal(data.ok, true);
	const byId = Object.fromEntries(data.checks.map((c) => [c.id, c]));
	for (const id of ["node", "hooks.scripts", "hooks.session_start", "skills", "skills.routing_coverage", "skills.script_refs", "versions"]) {
		assert.equal(byId[id]?.status, "ok", `${id}: ${byId[id]?.detail}`);
	}
	assert.equal(byId["guard_pack.sync"], undefined);
	assert.ok(byId["antigravity.model_provider"], "model provider check present");
	assert.equal(byId["rules.budget"]?.status, "ok", byId["rules.budget"]?.detail);
	assert.equal(byId["frontmatter.description_colon"]?.status, "ok", byId["frontmatter.description_colon"]?.detail);
});

test("#given rules/AGENTS.md #when measured #then it stays under the per-file budget that avoids silent exclusion", () => {
	const bytes = Buffer.byteLength(fs.readFileSync(path.join(ROOT, "rules", "AGENTS.md"), "utf8"), "utf8");
	assert.ok(bytes <= RULES_FILE_WARN_BYTES, `rules/AGENTS.md is ${bytes}B; keep it ≤${RULES_FILE_WARN_BYTES}B (antigravity-cli #1254)`);
});

test("#given API-key mode without a Neon mapping #when doctor runs #then model_provider warns and --strict fails", () => {
	const home = fs.mkdtempSync(path.join(os.tmpdir(), "lazyneon-home-"));
	try {
		fs.mkdirSync(path.join(home, ".gemini"), { recursive: true });
		fs.writeFileSync(path.join(home, ".gemini", "settings.json"), JSON.stringify({ modelProvider: "gemini", apiKey: "SECRET-SHOULD-NOT-PRINT" }), "utf8");
		const env = { ...process.env, HOME: home, USERPROFILE: home };
		const res = spawnSync("node", [path.join(ROOT, "scripts", "doctor.mjs"), "--json"], { cwd: ROOT, encoding: "utf8", env });
		const check = JSON.parse(res.stdout).checks.find((c) => c.id === "antigravity.model_provider");
		assert.equal(check.status, "warn");
		assert.match(check.detail, /gemini-4-neon 매핑 필요/);
		assert.doesNotMatch(res.stdout, /SECRET-SHOULD-NOT-PRINT/);
		const strict = spawnSync("node", [path.join(ROOT, "scripts", "doctor.mjs"), "--strict"], { cwd: ROOT, encoding: "utf8", env });
		assert.equal(strict.status, 1);

		fs.writeFileSync(path.join(home, ".gemini", "settings.json"), JSON.stringify({ modelProvider: "gemini", customModelsConfig: [{ id: "gemini-api://gemini-4-argon-high" }] }), "utf8");
		const mapped = spawnSync("node", [path.join(ROOT, "scripts", "doctor.mjs"), "--json"], { cwd: ROOT, encoding: "utf8", env });
		assert.equal(JSON.parse(mapped.stdout).checks.find((c) => c.id === "antigravity.model_provider").status, "warn");
		assert.match(JSON.parse(mapped.stdout).checks.find(c => c.id === "antigravity.model_provider").detail, /발견한 모델: gemini-4-argon-high/);

		fs.writeFileSync(path.join(home, ".gemini", "settings.json"), JSON.stringify({ modelProvider: "gemini", customModelsConfig: [{ id: "gemini-api://gemini-4-carbon-medium" }] }), "utf8");
		const carbonMapped = spawnSync("node", [path.join(ROOT, "scripts", "doctor.mjs"), "--json"], { cwd: ROOT, encoding: "utf8", env });
		assert.equal(JSON.parse(carbonMapped.stdout).checks.find((c) => c.id === "antigravity.model_provider").status, "warn");
        for (const id of ['gemini-4-neon', 'gemini-4-neon-high', 'gemini-4-neon-xhigh']) {
            fs.writeFileSync(path.join(home, '.gemini', 'settings.json'), JSON.stringify({ modelProvider: 'gemini', customModelsConfig: [{ id }] }));
            const neon = spawnSync('node', [path.join(ROOT, 'scripts', 'doctor.mjs'), '--json'], { cwd: ROOT, encoding: 'utf8', env });
            assert.equal(JSON.parse(neon.stdout).checks.find(c => c.id === 'antigravity.model_provider').status, 'ok');
            assert.ok(JSON.parse(neon.stdout).checks.find(c => c.id === 'antigravity.model_provider').detail.includes(`발견한 모델: ${id}`));
        }

		for (const id of ["some-neon-string", "gemini-4-neonish", "gemini-4-neon-minimal"]) {
			fs.writeFileSync(path.join(home, ".gemini", "settings.json"), JSON.stringify({ modelProvider: "gemini", description: "gemini-4-neon", customModelsConfig: [{ id }] }));
			const res = spawnSync("node", [path.join(ROOT, "scripts", "doctor.mjs"), "--json"], { cwd: ROOT, encoding: "utf8", env });
			assert.equal(JSON.parse(res.stdout).checks.find(c => c.id === "antigravity.model_provider").status, "warn");
		}

	} finally {
		fs.rmSync(home, { recursive: true, force: true });
	}
});

test("#given live_rpc mock payload #when customization has STATUS_ERROR #then doctor fails and reports the errored item", () => {
	const okMock = JSON.stringify({
		states: [
			{ name: "lazyneon/skills/ulw", status: "STATUS_ENABLED" },
			{ name: "unrelated-plugin/skills/forensic-report", status: "STATUS_ENABLED" },
		],
	});
	const okRes = spawnSync("node", [path.join(ROOT, "scripts", "doctor.mjs"), "--json"], {
		cwd: ROOT,
		encoding: "utf8",
		env: { ...process.env, LAZYNEON_LS_RPC_MOCK_JSON: okMock },
	});
	assert.equal(okRes.status, 0);
	const okCheck = JSON.parse(okRes.stdout).checks.find((c) => c.id === "antigravity.live_rpc");
	assert.equal(okCheck.status, "skip");
	assert.equal(okCheck.source, "mock");
	assert.match(okCheck.detail, /ENABLED 2개/);

	const errMock = JSON.stringify({
		states: [
			{ name: "lazyneon/skills/ulw", status: "STATUS_ENABLED" },
			{ name: "lazyneon/hooks.json", status: "STATUS_ERROR", error: "invalid hook format" },
		],
	});
	const errRes = spawnSync("node", [path.join(ROOT, "scripts", "doctor.mjs"), "--json"], {
		cwd: ROOT,
		encoding: "utf8",
		env: { ...process.env, LAZYNEON_LS_RPC_MOCK_JSON: errMock },
	});
	assert.equal(errRes.status, 1);
	const errCheck = JSON.parse(errRes.stdout).checks.find((c) => c.id === "antigravity.live_rpc");
	assert.equal(errCheck.status, "fail");
	assert.match(errCheck.detail, /lazyneon\/hooks\.json/);
});

test("#given unrouted skill and missing script ref #when doctor runs #then harness2 surface checks fail", () => {
	const fakeRoot = fs.mkdtempSync(path.join(os.tmpdir(), "lazyneon-h2-"));
	try {
		fs.mkdirSync(path.join(fakeRoot, "rules"), { recursive: true });
		fs.mkdirSync(path.join(fakeRoot, "skills", "orphan-skill"), { recursive: true });
		fs.writeFileSync(path.join(fakeRoot, "rules", "AGENTS.md"), "# Rules\n", "utf8");
		fs.writeFileSync(
			path.join(fakeRoot, "skills", "orphan-skill", "SKILL.md"),
			'---\nname: orphan-skill\ndescription: "test"\n---\nRun `python scripts/ghost_helper.py` now.\n',
			"utf8",
		);
		const res = spawnSync("node", [path.join(ROOT, "scripts", "doctor.mjs"), "--json"], {
			cwd: ROOT,
			encoding: "utf8",
			env: { ...process.env, LAZYNEON_TEST_SKILL_ROOT: fakeRoot },
		});
		assert.equal(res.status, 1);
		const byId = Object.fromEntries(JSON.parse(res.stdout).checks.map((c) => [c.id, c]));
		assert.equal(byId["skills.routing_coverage"]?.status, "fail");
		assert.match(byId["skills.routing_coverage"]?.detail, /orphan-skill/);
		assert.equal(byId["skills.script_refs"]?.status, "fail");
		assert.match(byId["skills.script_refs"]?.detail, /scripts\/ghost_helper\.py/);
	} finally {
		fs.rmSync(fakeRoot, { recursive: true, force: true });
	}
});

test("#given v2.1 orchestration rules and skills #when inspected #then Neon orchestrates Hydrogen workers with unmeasured routing, <=200-line single-shot guidance is active, and Opus 5.5 swarm critic is wired", () => {
	const agentsMd = fs.readFileSync(path.join(ROOT, "rules", "AGENTS.md"), "utf8");
	assert.doesNotMatch(agentsMd, /Routing:\s*`flash`/);
	assert.doesNotMatch(agentsMd, /only for built-in `browser`/);
	assert.match(agentsMd, /Hydrogen execution workers/);
	assert.match(agentsMd, /Neon high default/);
	assert.match(agentsMd, /≤200 lines \(<18KB\) single-shot/);
	assert.match(agentsMd, /\[미측정\]/);
	assert.match(agentsMd, /run_command 생략/);

	const ulwSkill = fs.readFileSync(path.join(ROOT, "skills", "ulw", "SKILL.md"), "utf8");
	assert.doesNotMatch(ulwSkill, /탐색·초안·포맷 레인 `flash`/);
	assert.doesNotMatch(ulwSkill, /내장 웹 UI 조작만 `browser`\(`flash`\)/);
	assert.match(ulwSkill, /Hydrogen 실행 워커/);
	assert.match(ulwSkill, /Edit-Only/);
	assert.match(ulwSkill, /≤200줄\(<18KB\)은 원샷 작성/);

	const ulwResearchSkill = fs.readFileSync(path.join(ROOT, "skills", "ulw-research", "SKILL.md"), "utf8");
	assert.doesNotMatch(ulwResearchSkill, /built-in `browser` subagent uses/);
	assert.match(ulwResearchSkill, /including `browser`/);

	const dualVerify = fs.readFileSync(path.join(ROOT, "skills", "ulw", "references", "dual-verify.md"), "utf8");
	assert.match(dualVerify, /final_review/);
	assert.match(dualVerify, /action:\s*"kill"/);

 const ruleFiles = fs.readdirSync(path.join(ROOT, "rules")).filter(f => f.endsWith(".md"));
 const total = ruleFiles.reduce((n, f) => n + fs.statSync(path.join(ROOT, "rules", f)).size, 0);
 assert.ok(total <= RULES_TOTAL_WARN_BYTES);
 assert.match(agentsMd, /파일당 16,000B, 합계 24,000B/);
 assert.match(agentsMd, /Neon xhigh/);
 assert.match(agentsMd, /Hydrogen execution workers/);
 assert.match(agentsMd, /100줄 이하 청크/);

});

test("unrelated plugin RPC error does not affect core", () => {
	const res = spawnSync("node", [path.join(ROOT, "scripts", "doctor.mjs"), "--json"], {
		cwd: ROOT, encoding: "utf8", env: { ...process.env, LAZYNEON_LS_RPC_MOCK_JSON: JSON.stringify({ states: [
			{ name: "lazyneon/skills/ulw", status: "STATUS_ENABLED" },
			{ name: "unrelated-plugin/hooks.json", status: "STATUS_ERROR" },
		] }) },
	});
	assert.equal(res.status, 0);
	const check = JSON.parse(res.stdout).checks.find(c => c.id === "antigravity.live_rpc");
	assert.equal(check.status, "skip");
	assert.equal(check.source, "mock");
	assert.match(check.detail, /lazyneon core 1개/);
});

test("doctor owns guards without sibling sync", () => {
 const source = fs.readFileSync(path.join(ROOT, "scripts", "doctor.mjs"), "utf8");
 assert.doesNotMatch(source, /guard_pack\.sync|sync_guard_pack|\.\.\/.*-workspace/);
});

test("#given no --live flag #when doctor runs #then it never probes a running Antigravity language server", () => {
	assertNoLiveProbes();
	const res = spawnSync("node", [path.join(ROOT, "scripts", "doctor.mjs"), "--json"], { cwd: ROOT, encoding: "utf8", env: { ...process.env, LAZYNEON_OFFLINE: "1", LAZYNEON_LS_RPC_MOCK_JSON: "" } });
	const checks = JSON.parse(res.stdout);
	const list = Array.isArray(checks) ? checks : checks.checks;
	const live = list.find((c) => (c.id ?? c.name) === "antigravity.live_rpc");
	assert.equal(live?.status, "skip", JSON.stringify(live));
	assert.match(live.detail, /--live/);
});

// All process/RPC boundaries are recorded; these fixtures never spawn a process.
function assertNoLiveProbes() {
 for (const settings of [{ live: false, offline: false }, { live: true, offline: true }]) {
  const calls = [];
  const spawnSync = (command, args) => {
   calls.push([command, args]);
   return { status: 0, stdout: command === 'ps' ? '123 language_server --csrf_token=fake\n' : command === 'lsof' ? 'TCP 127.0.0.1:12345 (LISTEN)\n' : JSON.stringify({ states: [{ name: 'lazyneon/skills/ulw', status: 'ENABLED' }] }) };
  };
  const result = liveRpcCheck({ ...settings, platform: 'darwin', mockJson: '', spawnSync });
  assert.deepEqual(calls, [], JSON.stringify(settings));
  assert.equal(result.status, 'skip');
 }
}
test("R7 high-3 consent and offline independently prevent ps lsof and RPC", assertNoLiveProbes);
