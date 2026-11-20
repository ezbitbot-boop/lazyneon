import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { buildCodeGraph } from "../scripts/codegraph.mjs";
import {
	A4_PRINT_INNER_MAX_PX,
	ASPECT_DRIFT,
	CELL_CONTENT_RATIO_MAX,
	CELL_VOID_MIN_PX,
	CELL_VOID_ROW_MIN_PX,
	HEADING_RATIO_MIN,
	OVERFLOW_PX,
	OVERLAP_PX,
	PAGE_FILL_MIN,
	SCROLL_SLACK_PX,
	checkLayout,
} from "../skills/ulw-research/scripts/gates-layout.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SELFCHECK_SCRIPT = path.join(ROOT, "scripts", "selfcheck_stats.mjs");

function makeBox(overrides) {
	const rect = overrides.rect ?? { x: 0, y: 0, w: 600, h: 32 };
	return {
		selector: "body > div",
		tag: "div",
		rect,
		parentSelector: "body",
		parentRect: { x: 0, y: 0, w: 960, h: 1200 },
		parentOverflow: { x: "visible", y: "visible" },
		scroll: { sw: rect.w, cw: rect.w, sh: rect.h, ch: rect.h },
		overflow: { x: "visible", y: "visible" },
		position: "static",
		isPage: false,
		...overrides,
	};
}

test("gates-layout.mjs: preserves 10 constants, skips print shrink on web docs, catches paged shrink & heading inversion", () => {
 assert.deepEqual(
  { OVERFLOW_PX, SCROLL_SLACK_PX, ASPECT_DRIFT, OVERLAP_PX, PAGE_FILL_MIN, CELL_VOID_ROW_MIN_PX, CELL_CONTENT_RATIO_MAX, CELL_VOID_MIN_PX, A4_PRINT_INNER_MAX_PX, HEADING_RATIO_MIN },
  { OVERFLOW_PX: 2, SCROLL_SLACK_PX: 2, ASPECT_DRIFT: 0.03, OVERLAP_PX: 12, PAGE_FILL_MIN: 0.6, CELL_VOID_ROW_MIN_PX: 84, CELL_CONTENT_RATIO_MAX: 0.3, CELL_VOID_MIN_PX: 52, A4_PRINT_INNER_MAX_PX: 674, HEADING_RATIO_MIN: 1.5 },
 );

	// (a) Non-paged web document: 120-char nowrap cell passes with 0 defects
	const webRes = checkLayout({
		probe_version: 1,
		boxes: [
			makeBox({ selector: "body > table", tag: "table", rect: { x: 0, y: 0, w: 720, h: 40 }, isPage: false }),
			makeBox({
				selector: "body > table > tr > td",
				tag: "td",
				rect: { x: 0, y: 0, w: 720, h: 40 },
				parentSelector: "body > table > tr",
				parentRect: { x: 0, y: 0, w: 720, h: 40 },
				whiteSpace: "nowrap",
				textLen: 120,
				isPage: false,
			}),
		],
	});
	assert.equal(webRes.defects.length, 0);

	// (b) Paged document: 720px table and 120-char nowrap cell trigger layout_print_shrink_risk
	const pagedRes = checkLayout({
		probe_version: 1,
		boxes: [
			makeBox({ selector: "body > .a4-sheet", tag: "section", rect: { x: 0, y: 0, w: 794, h: 1123 }, isPage: true }),
			makeBox({ selector: "body > .a4-sheet > table", tag: "table", rect: { x: 0, y: 0, w: 720, h: 40 }, parentSelector: "body > .a4-sheet", parentRect: { x: 0, y: 0, w: 794, h: 1123 } }),
			makeBox({
				selector: "body > .a4-sheet > table > tr > td",
				tag: "td",
				rect: { x: 0, y: 0, w: 720, h: 40 },
				parentSelector: "body > .a4-sheet > table > tr",
				parentRect: { x: 0, y: 0, w: 720, h: 40 },
				whiteSpace: "nowrap",
				textLen: 120,
			}),
		],
	});
	const shrinkDefects = pagedRes.defects.filter((d) => d.code === "layout_print_shrink_risk");
	assert.equal(shrinkDefects.length, 2);

	// (c) Gestalt heading spacing inversion: h2 with mt < 1.5 * mb preceded by flow sibling
	const headingRes = checkLayout({
		probe_version: 1,
		boxes: [
			makeBox({ selector: "body > article > p", tag: "p", rect: { x: 0, y: 0, w: 600, h: 24 }, parentSelector: "body > article", spacing: { pt: 0, pb: 0, mt: 0, mb: 12 } }),
			makeBox({ selector: "body > article > h2", tag: "h2", rect: { x: 0, y: 44, w: 600, h: 28 }, parentSelector: "body > article", spacing: { pt: 0, pb: 0, mt: 8, mb: 10 } }),
		],
	});
	assert.ok(headingRes.defects.some((d) => d.code === "layout_heading_spacing_inversion"));
});

test("selfcheck_stats.mjs: aggregates passed/corrected via --out without touching HOME and rejects unknown positional args", () => {
	const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "lazyneon-scstats-"));
	try {
		const fakeHome = path.join(tmp, "fake-home");
		fs.mkdirSync(fakeHome, { recursive: true });
		const logsDir = path.join(tmp, "brain", "conv-1", ".system_generated", "logs");
		fs.mkdirSync(logsDir, { recursive: true });
		const steps = [
			{
				step_index: 1,
				type: "SYSTEM_MESSAGE",
				created_at: "2026-11-10T10:00:00Z",
				content: "Stop hook blocked termination: [SELF-CHECK v1.1.0]\n점검할 문장:\n1. [전체·전부 단정] 세 파일 모두 통과했습니다.",
			},
			{ step_index: 2, type: "PLANNER_RESPONSE", content: "점검: 근거 있음 — npm test 3 passed" },
			{
				step_index: 3,
				type: "SYSTEM_MESSAGE",
				created_at: "2026-11-10T10:05:00Z",
				content: "Stop hook blocked termination: [SELF-CHECK v1.1.0]\n점검할 문장:\n1. [부재·불가 단정] 해당 기능은 전혀 없습니다.",
			},
			{ step_index: 4, type: "PLANNER_RESPONSE", content: "정정합니다: 조회한 경로 내에서는 확인하지 못했습니다." },
		];
		fs.writeFileSync(path.join(logsDir, "transcript_full.jsonl"), `${steps.map((s) => JSON.stringify(s)).join("\n")}\n`, "utf8");

		const outFile = path.join(tmp, "stats-out.json");
		const env = { ...process.env, HOME: fakeHome, USERPROFILE: fakeHome };
		const okRes = spawnSync(process.execPath, [SELFCHECK_SCRIPT, "--brain", path.join(tmp, "brain"), "--out", outFile], { encoding: "utf8", env });
		assert.equal(okRes.status, 0, okRes.stderr);
		assert.equal(fs.existsSync(path.join(fakeHome, ".lazyneon")), false);

		const stats = JSON.parse(fs.readFileSync(outFile, "utf8"));
		assert.equal(stats.reasks.length, 2);
		assert.equal(stats.by_kind["전체·전부 단정"]?.passed, 1);
		assert.equal(stats.by_kind["전체·전부 단정"]?.corrected, 0);
		assert.equal(stats.by_kind["부재·불가 단정"]?.corrected, 1);
		assert.equal(stats.by_kind["부재·불가 단정"]?.passed, 0);

		const badRes = spawnSync(process.execPath, [SELFCHECK_SCRIPT, "unknown-positional"], { encoding: "utf8", env });
		assert.equal(badRes.status, 2);
	} finally {
		fs.rmSync(tmp, { recursive: true, force: true });
	}
});

test("codegraph.mjs: keeps export after '/* not a comment */' literal, excludes experimental/, resolves Python '..shared'", () => {
	const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "lazyneon-cg-"));
	try {
		fs.mkdirSync(path.join(tmp, "src"), { recursive: true });
		fs.mkdirSync(path.join(tmp, "experimental", "scripts"), { recursive: true });
		fs.mkdirSync(path.join(tmp, "pkg", "sub"), { recursive: true });

		fs.writeFileSync(
			path.join(tmp, "src", "tricky.mjs"),
			'const closed = "/* not a comment */";\nconst unclosed = "/* still a string";\nexport function keepMe() {\n\treturn [closed, unclosed];\n}\n/* trailing comment */\n',
			"utf8",
		);
		fs.writeFileSync(path.join(tmp, "experimental", "scripts", "lab.mjs"), "export function labOnly() {}\n", "utf8");
		fs.writeFileSync(path.join(tmp, "pkg", "__init__.py"), "", "utf8");
		fs.writeFileSync(path.join(tmp, "pkg", "shared.py"), "def util():\n    return 1\n", "utf8");
		fs.writeFileSync(path.join(tmp, "pkg", "sub", "__init__.py"), "", "utf8");
		fs.writeFileSync(path.join(tmp, "pkg", "sub", "worker.py"), "from ..shared import util\n\ndef run():\n    return util()\n", "utf8");

		const graph = buildCodeGraph(tmp);
		assert.ok(graph.nodes["src/tricky.mjs"]?.exports.includes("keepMe"));
		assert.equal(graph.nodes["experimental/scripts/lab.mjs"], undefined);
		assert.ok(graph.nodes["pkg/sub/worker.py"]?.imports_internal.includes("pkg/shared.py"));
	} finally {
		fs.rmSync(tmp, { recursive: true, force: true });
	}
});

test('R7 low-8 all layout thresholds below at and above the boundary', () => {
 const has = (boxes, code) => checkLayout({ probe_version: 1, boxes: boxes.map(makeBox) }).defects.some(d => d.code === code);
 const sweep = (values, expected, build, code) => values.forEach((v, i) => assert.equal(has(build(v), code), expected[i], `${code} at ${v}`));
 sweep([1.9, 2, 2.1], [false, false, true], v => [{ rect: { x: 0, y: 0, w: 960 + v, h: 32 } }], 'layout_overflow');
 sweep([1.9, 2, 2.1], [false, false, true], v => [{ scroll: { sw: 100 + v, cw: 100, sh: 32, ch: 32 }, overflow: { x: 'hidden', y: 'visible' } }], 'layout_text_clipped');
 // Values are independent of the exported threshold constants.
 sweep([0.029, 0.03, 0.031], [false, false, true], v => [{ tag: 'img', natural: { w: 1, h: 1 }, rect: { x: 0, y: 0, w: 1, h: 1 / (1 + v) } }], 'layout_image_distorted');
 sweep([11.9, 12, 12.1], [false, false, true], v => [{ selector: 'a', rect: { x: 0, y: 0, w: 100, h: 100 } }, { selector: 'b', rect: { x: 100 - v, y: 100 - v, w: 100, h: 100 } }], 'layout_sibling_overlap');
 sweep([599.9, 600, 600.1], [true, false, false], v => [{ isPage: true, flowBottom: v, rect: { x: 0, y: 0, w: 700, h: 1000 } }, { isPage: true, rect: { x: 0, y: 1000, w: 700, h: 1000 } }], 'layout_page_underfill');
 const cells = (row, height, content) => [{ tag: 'tr', selector: 'tr', rect: { x: 0, y: 0, w: 200, h: row } }, ...[content, 70].map((contentH, i) => ({ tag: 'td', selector: `td${i}`, parentSelector: 'tr', contentH, rect: { x: i * 100, y: 0, w: 100, h: height } }))];
 sweep([83.9, 84, 84.1], [false, true, true], v => cells(v, 100, 20), 'layout_cell_void_imbalance');
 sweep([29.9, 30, 30.1], [true, true, false], v => cells(100, 100, v), 'layout_cell_void_imbalance');
 sweep([51.9, 52, 52.1], [false, true, true], v => cells(100, v + 10, 10), 'layout_cell_void_imbalance');
 sweep([673.9, 674, 674.1], [false, false, true], v => [{ isPage: true }, { tag: 'table', rect: { x: 0, y: 0, w: v, h: 32 } }], 'layout_print_shrink_risk');
 sweep([14.9, 15, 15.1], [true, false, false], v => [{ tag: 'p' }, { tag: 'h2', spacing: { mt: v, mb: 10 } }], 'layout_heading_spacing_inversion');
});
