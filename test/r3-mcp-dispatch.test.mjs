import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { hookTargets } from '../scripts/hook_targets.mjs';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const hooks = JSON.parse(fs.readFileSync(path.join(root, 'hooks.json'))).hooks;
function dispatch(event, payload, dir) {
 const results = [];
 for (const group of hooks[event]) {
  if (group.matcher && !new RegExp(group.matcher).test(payload.tool_name)) continue;
  for (const hook of group.hooks || [group]) {
   const [command, ...args] = hook.command.split(' ');
   assert.equal(command, 'node');
   const r = spawnSync(process.execPath, args, {cwd:root, input:JSON.stringify(payload), encoding:'utf8', timeout:20000,
    env:{...process.env, LAZYNEON_OFFLINE:'1', LAZYNEON_FEEDBACK_DIR:dir}});
   assert.equal(r.error, undefined);
   results.push(r);
  }
 }
 return results;
}
for (const name of ['call_mcp_tool', 'CallMcpTool', 'mcp__files__write_document', 'custom_document_update', 'search_replace']) {
 test(`R3 H3 real hooks dispatcher guards ${name}`, t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'neon-mcp-'));
  t.after(() => fs.rmSync(dir, {recursive:true, force:true}));
  for (const [ext, content] of [['md', '```\nunfinished'], ['json', '{bad']]) {
   fs.writeFileSync(path.join(dir, `bad.${ext}`), content);
   const args = {[ext === 'md' ? 'path' : 'output_path']:`bad.${ext}`, content:ext === 'md' ? 'x\n'.repeat(260) : 'x'.repeat(25 * 1024)};
   const payload = {workspacePaths:[dir], conversationId:`mcp-${ext}`, tool_name:name,
    tool_input:name.toLowerCase() === 'call_mcp_tool' ? {server:'files', tool:'write_document', ...(ext === 'md' ? {args} : {arguments:JSON.stringify(args)})} : args};
   const pre = dispatch('PreToolUse', payload, dir);
   assert.ok(pre.some(r => r.status === 1 && JSON.parse(r.stdout).decision === 'deny'), 'oversized MCP write must be denied');
   assert.deepEqual(hookTargets([{parsed:payload}]), [path.join(dir, `bad.${ext}`)]);
   const post = dispatch('PostToolUse', payload, dir);
   assert.ok(post.length); post.forEach(r => assert.equal(r.status, 0, r.stderr));
   assert.match(dispatch('PreInvocation', payload, dir)[0].stdout, /GUARD/);
  }
 });
}
test('R3 H3 dispatcher allows MCP reads and small writes', t => {
 const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'neon-mcp-'));
 t.after(() => fs.rmSync(dir, {recursive:true, force:true}));
 fs.writeFileSync(path.join(dir, 'bad.json'), '{bad');
 for (const name of ['call_mcp_tool', 'mcp__files__read_document']) {
  const payload = {workspacePaths:[dir], conversationId:'read', tool_name:name,
   tool_input:name === 'call_mcp_tool' ? {tool:'read_document', args:{path:'bad.json'}} : {path:'bad.json'}};
  dispatch('PreToolUse', payload, dir).forEach(r => assert.equal(r.status, 0));
  dispatch('PostToolUse', payload, dir);
  assert.doesNotMatch(dispatch('PreInvocation', payload, dir)[0].stdout, /GUARD/);
 }
 fs.writeFileSync(path.join(dir, 'ok.json'), '{}');
 const payload = {workspacePaths:[dir], conversationId:'small', tool_name:'call_mcp_tool', tool_input:{tool:'write_document', args:{path:'ok.json', content:'{}'}}};
 const pre = dispatch('PreToolUse', payload, dir); assert.ok(pre.length);
 pre.forEach(r => assert.deepEqual(JSON.parse(r.stdout), {}));
 dispatch('PostToolUse', payload, dir);
 assert.doesNotMatch(dispatch('PreInvocation', payload, dir)[0].stdout, /GUARD/);
});
test('R3 receipt retains showreel provenance at experimental video-editor path', () => {
 const receipt = JSON.parse(fs.readFileSync(path.join(root, 'docs/skill-source-receipts.json'))).sources.find(s => s.repo === 'revfactory/showreel');
 assert.equal(receipt.pinned_sha, '64521220a2f8e91cb9894400c48c15b7f45205d6');
 assert.deepEqual(receipt.mapped_targets, [{path:'../lazyneon-workspace/experimental/video-editor/references/showreel-videogen.md', scope:'external'}]);
});
