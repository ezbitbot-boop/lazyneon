import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import test from 'node:test';

const root = new URL('../', import.meta.url);
const hooks = JSON.parse(fs.readFileSync(new URL('hooks.json', root))).hooks.PreToolUse;
const write = content => ({ toolCall: { name: 'write_file', args: { Path: '/tmp/example.txt', Content: content } } });

for (const [label, payload, disabled, denied] of [
  ['small write', write('hello'), false, false],
  ['read', { toolCall: { name: 'read_file', args: { Path: '/tmp/example.txt' } } }, false, false],
  ['empty payload', {}, false, false],
  ['malformed payload', '{broken', false, false],
  ['disabled guard', write('x'.repeat(25000)), true, false],
  ['oversized write', write('x'.repeat(25000)), false, true],
]) {
  test(`R6 PreToolUse emits a decision only on denial: ${label}`, () => {
    const env = { ...process.env, LAZYNEON_OFFLINE: '1', LAZYNEON_DISABLE_WRITE_CHUNK_GUARD: disabled ? '1' : '0' };
    for (const key of ['ANTIGRAVITY_TOOL_INPUT', 'TOOL_INPUT', 'LAZYNEON_MAX_WRITE_BYTES', 'LAZYNEON_MAX_WRITE_LINES']) delete env[key];
    let count = 0;
    for (const group of hooks) {
      if (group.matcher && !new RegExp(group.matcher).test(payload.toolCall?.name || '')) continue;
      for (const hook of group.hooks || [group]) {
        count++;
        const result = spawnSync(hook.command, { shell: true, cwd: root, env,
          input: typeof payload === 'string' ? payload : JSON.stringify(payload), encoding: 'utf8', timeout: 5000 });
        assert.ifError(result.error);
        // Only the size guard judges these payloads; destructive_guard has no opinion on them.
        const expectDeny = denied && hook.command.includes('write_chunk_guard');
        assert.equal(result.status, expectDeny ? 1 : 0, result.stderr);
        const output = JSON.parse(result.stdout);
        if (expectDeny) {
          assert.equal(output.decision, 'deny');
          assert.match(output.reason, /stream cutoff guard/);
        } else {
          assert.equal(result.stdout, '{}\n');
          assert.deepEqual(output, {});
        }
      }
    }
    assert.ok(count > 0, 'must execute registered PreToolUse hooks');
  });
}
