import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const guard = fileURLToPath(new URL('../scripts/write_chunk_guard.mjs', import.meta.url));

// A disabled guard must still read its stdin: exiting with a payload larger than the OS pipe buffer
// unread makes the host's write fail with EPIPE (16 KB buffer on macOS, 64 KB on Linux).
for (const size of [25000, 256000]) {
  test(`disabled write chunk guard drains a ${size} B stdin payload`, async () => {
    const env = { ...process.env, LAZYNEON_OFFLINE: '1', LAZYNEON_DISABLE_WRITE_CHUNK_GUARD: '1' };
    for (const key of ['ANTIGRAVITY_TOOL_INPUT', 'TOOL_INPUT']) delete env[key];
    const payload = JSON.stringify({ toolCall: { name: 'write_file', args: { Path: '/tmp/example.txt', Content: 'x'.repeat(size) } } });
    const child = spawn(process.execPath, [guard], { env, stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    child.stdout.setEncoding('utf8').on('data', chunk => { stdout += chunk; });
    const written = new Promise(resolve => {
      child.stdin.on('error', resolve);
      child.stdin.end(payload, error => resolve(error ?? null));
    });
    const status = await new Promise(resolve => child.on('close', resolve));
    assert.equal(await written, null);
    assert.equal(status, 0);
    assert.equal(stdout, '{}\n');
  });
}
