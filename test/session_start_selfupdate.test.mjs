/**
 * test/session_start_selfupdate.test.mjs
 *
 * Tests for autoUpdate() in scripts/session_start.mjs.
 * Uses throwaway local bare-origin + clone repos — no network required.
 * Cases: clean+behind (fast-forward), dirty+behind (notice), up-to-date (silent),
 *        opt-out env, throttle (24 h), non-main branch, fetch failure.
 */
import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
// import() needs a file:// URL: a bare Windows path (D:\...) is read as the URL scheme "d:".
const { autoUpdate } = await import(pathToFileURL(path.join(ROOT, "scripts", "session_start.mjs")).href);
const { updateCommand } = await import(pathToFileURL(path.join(ROOT, "scripts", "update.mjs")).href);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Fake writable stream that collects written strings. */
function makeCapture() {
	const lines = [];
	return {
		write(chunk) {
			lines.push(typeof chunk === "string" ? chunk : chunk.toString());
			return true;
		},
		get text() {
			return lines.join("");
		},
		lines,
	};
}

const GIT_ENV = {
	GIT_AUTHOR_NAME: "Test",
	GIT_AUTHOR_EMAIL: "test@example.com",
	GIT_COMMITTER_NAME: "Test",
	GIT_COMMITTER_EMAIL: "test@example.com",
};

function exec(cmd, cwd) {
	return execSync(cmd, { cwd, stdio: "pipe", env: { ...process.env, ...GIT_ENV } });
}

/**
 * Create a bare origin + a clone in tmp.
 * Returns { origin, clone } absolute paths.
 * The clone:
 *   - is on branch main with origin remote pointing to the bare origin
 */
function setupRepo(tmp) {
	const origin = path.join(tmp, "origin.git");
	const work = path.join(tmp, "work");
	const clone = path.join(tmp, "clone");

	// Bare origin.
	exec(`git init --bare -b main "${origin}"`, tmp);

	// Working copy to seed the origin.
	fs.mkdirSync(work);
	exec(`git init -b main "${work}"`, tmp);
	exec(`git -C "${work}" config user.email "test@example.com"`, tmp);
	exec(`git -C "${work}" config user.name "Test"`, tmp);
	fs.writeFileSync(path.join(work, "README.md"), "init\n", "utf8");
	exec(`git -C "${work}" add .`, tmp);
	exec(`git -C "${work}" commit -m "init"`, tmp);
	exec(`git -C "${work}" remote add origin "${origin}"`, tmp);
	exec(`git -C "${work}" push origin main`, tmp);

	// Clone from bare origin.
	exec(`git clone "${origin}" "${clone}"`, tmp);
	exec(`git -C "${clone}" config user.email "test@example.com"`, tmp);
	exec(`git -C "${clone}" config user.name "Test"`, tmp);

	return { origin, clone, work };
}

/** Push a new commit to the bare origin via the work checkout. */
function pushNewCommit(work, message = "upstream") {
	const fname = `file-${Date.now()}.txt`;
	fs.writeFileSync(path.join(work, fname), `${message}\n`, "utf8");
	exec(`git -C "${work}" add .`, work);
	exec(`git -C "${work}" commit -m "${message}"`, work);
	exec(`git -C "${work}" push origin main`, work);
}

// ---------------------------------------------------------------------------
// Test cases
// ---------------------------------------------------------------------------

test("clean+behind: fast-forwards and prints one update line", () => {
	const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "la-upd-clean-"));
	try {
		const { work, clone } = setupRepo(tmp);
		pushNewCommit(work, "upstream-commit-1");

		const cap = makeCapture();
		autoUpdate(clone, { LAZYNEON_AUTO_UPDATE: "1" }, cap);

		// Clone HEAD should now equal origin/main.
		const cloneHead = exec(`git -C "${clone}" rev-parse HEAD`, clone).toString().trim();
		const originHead = exec(`git -C "${clone}" rev-parse origin/main`, clone).toString().trim();
		assert.equal(cloneHead, originHead, "clone was fast-forwarded to origin/main");

		assert.equal(cap.lines.length, 1, "exactly one line written");
		assert.match(
			cap.lines[0],
			/^LazyNeon updated [0-9a-f]{7}\.\.[0-9a-f]{7} \(1 commits?\)\n$/,
			"update line matches expected format",
		);
	} finally {
		fs.rmSync(tmp, { recursive: true, force: true });
	}
});

test("dirty+behind: leaves files untouched and prints notice", () => {
	const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "la-upd-dirty-"));
	try {
		const { work, clone } = setupRepo(tmp);
		pushNewCommit(work, "upstream-commit-2");

		// Dirty the clone working tree (tracked file, unstaged change).
		fs.appendFileSync(path.join(clone, "README.md"), "local change\n", "utf8");

		const headBefore = exec(`git -C "${clone}" rev-parse HEAD`, clone).toString().trim();
		const readmeBefore = fs.readFileSync(path.join(clone, "README.md"), "utf8");

		const cap = makeCapture();
		autoUpdate(clone, { LAZYNEON_AUTO_UPDATE: "1" }, cap);

		// HEAD must be unchanged.
		const headAfter = exec(`git -C "${clone}" rev-parse HEAD`, clone).toString().trim();
		assert.equal(headAfter, headBefore, "HEAD was not moved");

		// Local file must be unchanged.
		assert.equal(
			fs.readFileSync(path.join(clone, "README.md"), "utf8"),
			readmeBefore,
			"README.md was not modified",
		);

		assert.equal(cap.lines.length, 1, "exactly one line written");
		assert.match(cap.lines[0], /local changes present, not auto-updated/, "notice includes 'local changes present'");
		// Separator-agnostic: Windows prints C:\...\bin\lazyneon.
		assert.match(cap.lines[0], /bin[\\/]lazyneon.* update/, "notice includes safe update command");
	} finally {
		fs.rmSync(tmp, { recursive: true, force: true });
	}
});

test("up to date: completely silent", () => {
	const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "la-upd-utd-"));
	try {
		const { clone } = setupRepo(tmp);

		const cap = makeCapture();
		autoUpdate(clone, { LAZYNEON_AUTO_UPDATE: "1" }, cap);

		assert.equal(cap.lines.length, 0, "no output when up to date");
	} finally {
		fs.rmSync(tmp, { recursive: true, force: true });
	}
});

test("LAZYNEON_NO_AUTO_UPDATE=1: skips entirely with no git calls", () => {
	const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "la-upd-optout-"));
	try {
		const { origin, work, clone } = setupRepo(tmp);
		pushNewCommit(work, "upstream-commit-optout");

		const cap = makeCapture();
		autoUpdate(clone, { LAZYNEON_NO_AUTO_UPDATE: "1" }, cap);

		// No output.
		assert.equal(cap.lines.length, 0, "no output when opted out");

		// Clone still at old commit — merge was NOT performed.
		// Compare against bare origin's actual HEAD (not clone's cached origin/main ref,
		// which is also at the old commit because we never fetched).
		const cloneHead = exec(`git -C "${clone}" rev-parse HEAD`, clone).toString().trim();
		const bareOriginHead = exec(`git -C "${origin}" rev-parse HEAD`, tmp).toString().trim();
		assert.notEqual(cloneHead, bareOriginHead, "clone was NOT fast-forwarded to upstream");
	} finally {
		fs.rmSync(tmp, { recursive: true, force: true });
	}
});

test("throttle: second call within 24 h does not fetch", () => {
	const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "la-upd-throttle-"));
	try {
		const { origin, work, clone } = setupRepo(tmp);
		pushNewCommit(work, "upstream-commit-throttle");

		// First call: should update.
		const cap1 = makeCapture();
		autoUpdate(clone, { LAZYNEON_AUTO_UPDATE: "1" }, cap1);
		assert.equal(cap1.lines.length, 1, "first call updates");

		// Push another commit upstream — clone won't get it if throttled.
		pushNewCommit(work, "upstream-commit-throttle-2");

		// Second call within 24 h (state file just written): must skip.
		const cap2 = makeCapture();
		autoUpdate(clone, { LAZYNEON_AUTO_UPDATE: "1" }, cap2);
		assert.equal(cap2.lines.length, 0, "second call within 24 h is silent");

		// Clone should NOT have the second commit.
		// Compare against bare origin's actual HEAD (which now has commit2).
		const cloneHead = exec(`git -C "${clone}" rev-parse HEAD`, clone).toString().trim();
		const bareOriginHead = exec(`git -C "${origin}" rev-parse HEAD`, tmp).toString().trim();
		assert.notEqual(cloneHead, bareOriginHead, "clone was not updated on the second (throttled) call");
	} finally {
		fs.rmSync(tmp, { recursive: true, force: true });
	}
});

test("non-main branch: skips entirely", () => {
	const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "la-upd-branch-"));
	try {
		const { origin, work, clone } = setupRepo(tmp);
		pushNewCommit(work, "upstream-commit-branch");

		// Switch clone to a different branch before autoUpdate runs.
		exec(`git -C "${clone}" checkout -b feat/something`, clone);

		const cap = makeCapture();
		autoUpdate(clone, { LAZYNEON_AUTO_UPDATE: "1" }, cap);

		assert.equal(cap.lines.length, 0, "no output when not on main");

		// Clone's main was not updated — verify against bare origin's actual HEAD.
		exec(`git -C "${clone}" checkout main`, clone);
		const cloneHead = exec(`git -C "${clone}" rev-parse HEAD`, clone).toString().trim();
		const bareOriginHead = exec(`git -C "${origin}" rev-parse HEAD`, tmp).toString().trim();
		assert.notEqual(cloneHead, bareOriginHead, "clone main was not updated when on a different branch");
	} finally {
		fs.rmSync(tmp, { recursive: true, force: true });
	}
});

test("fetch failure: silent, no exception, exit-safe", () => {
	const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "la-upd-fetchfail-"));
	try {
		const { clone } = setupRepo(tmp);

		// Point origin at a non-existent path to simulate network/fetch failure.
		exec(`git -C "${clone}" remote set-url origin "/nonexistent-path-${Date.now()}"`, clone);

		const cap = makeCapture();
		// Must not throw and must remain silent.
		assert.doesNotThrow(() => autoUpdate(clone, { LAZYNEON_AUTO_UPDATE: "1" }, cap));
		assert.equal(cap.lines.length, 0, "no output on fetch failure");
	} finally {
		fs.rmSync(tmp, { recursive: true, force: true });
	}
});

/** Expire the throttle stamp so the next call checks again. */
function expireThrottle(clone) {
	const stamp = path.join(clone, ".git", "lazyneon-last-update-check");
	fs.writeFileSync(stamp, String(Date.now() - 25 * 60 * 60 * 1000), "utf8");
}

test("throttle stamp never dirties the tree: a later check still fast-forwards", () => {
	const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "la-upd-stamp-"));
	try {
		const { work, clone } = setupRepo(tmp);
		pushNewCommit(work, "first");
		autoUpdate(clone, { LAZYNEON_AUTO_UPDATE: "1" }, makeCapture());
		assert.equal(exec(`git -C "${clone}" status --porcelain`, clone).toString(), "", "tree clean after a check");

		pushNewCommit(work, "second");
		expireThrottle(clone);
		const cap = makeCapture();
		autoUpdate(clone, { LAZYNEON_AUTO_UPDATE: "1" }, cap);
		assert.equal(cap.lines.length, 1);
		assert.match(cap.lines[0], /^LazyNeon updated /);
	} finally {
		fs.rmSync(tmp, { recursive: true, force: true });
	}
});

test("only local commits ahead, nothing new upstream: silent", () => {
	const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "la-upd-ahead-"));
	try {
		const { clone } = setupRepo(tmp);
		fs.writeFileSync(path.join(clone, "local.txt"), "mine\n", "utf8");
		exec(`git -C "${clone}" add . && git -C "${clone}" commit -m local`, clone);
		const cap = makeCapture();
		autoUpdate(clone, { LAZYNEON_AUTO_UPDATE: "1" }, cap);
		assert.equal(cap.lines.length, 0);
	} finally {
		fs.rmSync(tmp, { recursive: true, force: true });
	}
});

test("diverged (local commit + upstream commit): no merge, notice names local commits", () => {
	const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "la-upd-diverged-"));
	try {
		const { work, clone } = setupRepo(tmp);
		fs.writeFileSync(path.join(clone, "local.txt"), "mine\n", "utf8");
		exec(`git -C "${clone}" add . && git -C "${clone}" commit -m local`, clone);
		const before = exec(`git -C "${clone}" rev-parse HEAD`, clone).toString().trim();
		pushNewCommit(work, "upstream");
		const cap = makeCapture();
		autoUpdate(clone, { LAZYNEON_AUTO_UPDATE: "1" }, cap);
		assert.equal(exec(`git -C "${clone}" rev-parse HEAD`, clone).toString().trim(), before, "HEAD unchanged");
		assert.equal(cap.lines.length, 1);
		assert.match(cap.lines[0], /local commits differ, not auto-updated/);
	} finally {
		fs.rmSync(tmp, { recursive: true, force: true });
	}
});

test('notify default: bare upstream produces one line without moving HEAD or tree', () => {
 const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'la-notify-'));
 try {
  const {work,clone}=setupRepo(tmp); pushNewCommit(work,'notification');
  const before=exec('git rev-parse HEAD',clone).toString().trim();
  const newer=exec('git rev-parse HEAD',work).toString().trim();
  const cap=makeCapture(); const line=autoUpdate(clone,{},cap);
  // The command is quoted for the platform shell: POSIX single quotes, cmd.exe double quotes on Windows.
  assert.equal(line,`LazyNeon update available: ${before.slice(0,7)} → ${newer.slice(0,7)} (1 commits). Run: ${updateCommand(clone)}`);
  assert.match(line,process.platform==='win32'?/Run: node "[^"]+lazyneon" update$/:/Run: node '[^']+lazyneon' update$/);
  assert.equal(exec('git rev-parse HEAD',clone).toString().trim(),before);
  assert.equal(exec('git status --porcelain',clone).toString(),'');
  assert.equal(cap.text,'');
  fs.writeFileSync(path.join(clone,'.git/lazyneon-last-update-check'),String(Date.now()-23*3600000));
  assert.equal(autoUpdate(clone,{},cap),undefined,'24 hour throttle');
 } finally {fs.rmSync(tmp,{recursive:true,force:true});}
});

test('update CLI refuses dirty tree, shows changelog, and fast-forwards only', async () => {
 const {spawnSync}=await import('node:child_process');
 const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'la-cli-'));
 try {
  const {work,clone}=setupRepo(tmp); pushNewCommit(work,'changelog-entry');
  // Run the real CLI from a copied installation, updating only the fixture checkout.
  for(const dir of ['bin','scripts'])fs.cpSync(path.join(ROOT,dir),path.join(clone,dir),{recursive:true});
  fs.copyFileSync(path.join(ROOT,'package.json'),path.join(clone,'package.json'));
  fs.appendFileSync(path.join(clone,'.git/info/exclude'),'\nbin/\nscripts/\npackage.json\n');
  const run=()=>spawnSync(process.execPath,[path.join(clone,'bin/lazyneon'),'update'],{encoding:'utf8',env:{...process.env,LAZYNEON_OFFLINE:'0'}});
  fs.appendFileSync(path.join(clone,'README.md'),'dirty\n');
  const dirty=run(); assert.notEqual(dirty.status,0); assert.match(dirty.stderr,/local changes/i);
  fs.writeFileSync(path.join(clone,'README.md'),'init\n');
  const clean=run(); assert.equal(clean.status,0,clean.stderr); assert.match(clean.stdout,/changelog-entry/);
  assert.equal(exec('git rev-parse HEAD',clone).toString(),exec('git rev-parse HEAD',work).toString());
  fs.writeFileSync(path.join(clone,'local.txt'),'local');exec('git add local.txt',clone);exec('git commit -m local',clone);
  pushNewCommit(work,'diverged');const head=exec('git rev-parse HEAD',clone).toString();
  assert.notEqual(run().status,0);assert.equal(exec('git rev-parse HEAD',clone).toString(),head);
 } finally {fs.rmSync(tmp,{recursive:true,force:true});}
});

test('update policy documentation describes notify-only and explicit command',()=>{
 const readme=fs.readFileSync(path.join(ROOT,'README.md'),'utf8');
 assert.match(readme,/## Updates/);assert.match(readme,/LAZYNEON_NO_UPDATE_CHECK/);assert.match(readme,/node bin\/lazyneon update/);
});

test('offline and no-update-check skip every git call; default only fetches refs', async () => {
 const {spawnSync}=await import('node:child_process');
 const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'la-policy-'));
 try {
  const {work,clone}=setupRepo(tmp);pushNewCommit(work,'refs-only');
  const trace=path.join(tmp,'trace');
  const run=env=>spawnSync(process.execPath,['--input-type=module','-e',`import {autoUpdate} from ${JSON.stringify(new URL('../scripts/session_start.mjs',import.meta.url).href)}; console.log(autoUpdate(${JSON.stringify(clone)},process.env) ?? '');`],{encoding:'utf8',env:{...process.env,LAZYNEON_OFFLINE:'0',LAZYNEON_NO_AUTO_UPDATE:'0',LAZYNEON_NO_UPDATE_CHECK:'0',LAZYNEON_AUTO_UPDATE:'0',GIT_TRACE:trace,...env}});
  for(const env of [{LAZYNEON_OFFLINE:'1',LAZYNEON_AUTO_UPDATE:'1'},{LAZYNEON_NO_UPDATE_CHECK:'1',LAZYNEON_AUTO_UPDATE:'1'}]){
   assert.equal(run(env).status,0);assert.equal(fs.existsSync(trace),false);
  }
  const res=run({});assert.match(res.stdout,/LazyNeon update available:/);
  const calls=fs.readFileSync(trace,'utf8');assert.match(calls,/fetch --no-tags --no-recurse-submodules origin refs\/heads\/main/);
  assert.doesNotMatch(calls,/built-in: git (?:merge|pull|checkout|reset|rebase|push)/);
  const saved=calls;run({});assert.equal(fs.readFileSync(trace,'utf8').slice(saved.length).includes('fetch'),false);
 } finally {fs.rmSync(tmp,{recursive:true,force:true});}
});

test('SessionStart injects the notify line exactly once into systemMessage', async () => {
 const {spawnSync}=await import('node:child_process');
 const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'la-inject-'));
 try {
  const {work,clone}=setupRepo(tmp);pushNewCommit(work,'session-notice');
  fs.cpSync(path.join(ROOT,'scripts'),path.join(clone,'scripts'),{recursive:true});
  fs.copyFileSync(path.join(ROOT,'plugin.json'),path.join(clone,'plugin.json'));
  fs.cpSync(path.join(ROOT,'skills/ulw/references'),path.join(clone,'skills/ulw/references'),{recursive:true});
  const before=exec('git rev-parse HEAD',clone).toString();
  const r=spawnSync(process.execPath,[path.join(clone,'scripts/session_start.mjs')],{cwd:clone,input:'{}',encoding:'utf8',env:{...process.env,LAZYNEON_OFFLINE:'0',LAZYNEON_NO_AUTO_UPDATE:'0',LAZYNEON_NO_UPDATE_CHECK:'0',LAZYNEON_AUTO_UPDATE:'0'}});
  assert.equal(r.status,0,r.stderr);
  const ctx=JSON.parse(r.stdout).injectSteps[0].systemMessage.systemMessage;
  assert.equal(ctx.split('\n').filter(l=>l.startsWith('LazyNeon update available:')).length,1);
  assert.match(ctx,/\(1 commits\)\. Run: node .* update/);
  assert.equal(exec('git rev-parse HEAD',clone).toString(),before);
 } finally {fs.rmSync(tmp,{recursive:true,force:true});}
});
