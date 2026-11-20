/** Collect every edited path, including freeform patches and encoded arguments. */
import path from 'node:path';
import { shellWrites } from './shell_targets.mjs';
import { resolveWorkspace } from './workspace-path.mjs';
// Matchers cannot inspect arguments: dispatch all tools, then exempt explicit reads.
export function isReadOnlyTool(payload) {
 const decode = value => { try { return typeof value === 'string' ? JSON.parse(value) : value; } catch { return null; } };
 let node = decode(payload);
 const outerName = node?.tool_name ?? node?.toolCall?.name ?? node?.name ?? '';
 let name = node?.tool_name ?? node?.toolCall?.name ?? node?.name ?? '';
 node = decode(node?.toolCall?.args ?? node?.toolCall?.arguments ?? node?.tool_input ?? node?.input ?? node?.args);
 if (/^call_mcp_tool$/i.test(name) || /^CallMcpTool$/i.test(name)) name = node?.tool ?? node?.tool_name ?? node?.name ?? '';
 const mcp = /^mcp__|^call_mcp_tool$|^CallMcpTool$/.test(outerName);
 name = typeof name === 'string' ? name.split('__').at(-1) : '';
 const semanticName = name.replace(/([a-z])([A-Z])/g, '$1_$2');
 if (/(?:^|_)(?:write|edit|update|replace|delete|remove|move|create|append|patch|fill|insert|save|upload|set|run|execute|command|bash|shell|terminal)(?:_|$)/i.test(semanticName)) return false;
 if (mcp && name) return true;
 return /^(?:(?:get|read|list|search|find)_(?!update|replace|write|delete|edit).*|read_document|read_file|ReadFile|Read|view_file|view_file_outline|view_code_item|list_dir|grep_search|find_by_name|search_web|read_url_content|codebase_search)$/.test(name);
}

export function hookTargets(sources, { contentOnly = false } = {}) {
 const out = new Set();
 const payloads = sources.map(s => s.parsed).filter(Boolean);
 const workspace = payloads.map(p => resolveWorkspace(p, null)).find(Boolean) || process.cwd();
 const add = value => { if (value) out.add(path.resolve(workspace, value)); };
 function visit(node) {
  if (typeof node === 'string') {
   try { visit(JSON.parse(node)); return; } catch {}
   const operations = [...node.matchAll(/^\*\*\* (Update File|Add File|Delete File|Move to): (.+)$/gm)];
   for (let i = 0; i < operations.length; i++) {
    const [, op, target] = operations[i];
    if (contentOnly && (op === 'Delete File' || (op === 'Update File' && operations[i + 1]?.[1] === 'Move to'))) continue;
    add(target.trim());
   }
   return;
  }
  if (Array.isArray(node)) { node.forEach(visit); return; }
  if (!node || typeof node !== 'object') return;
  for (const [key,value] of Object.entries(node)) {
   if (/^(file_path|filepath|path|target|target_file|targetfile|target_path|targetpath|output|output_path|outputpath|destination_path|destinationpath|file|filename)$/i.test(key) && typeof value === 'string') {
    if (key === 'Target' && ('Path' in node || 'Replacement' in node)) continue;
    let v=value; try { const parsed=JSON.parse(v); if(typeof parsed==='string') v=parsed; } catch {}
    add(v);
   } else if (/^(command|cmd|command_line|commandline|script)$/i.test(key) && typeof value === 'string') {
    for(const target of shellWrites(value, workspace, {contentOnly}).targets) add(target);
   } else if (value && typeof value === 'object' || /^(args|arguments|tool_input|input|parameters|patch|diff|patchText)$/i.test(key) || (typeof value === 'string' && /^\*\*\* (?:Update File|Add File|Delete File|Move to): /m.test(value) && !/response|result|content|stdout|stderr/i.test(key))) visit(value);
  }
 }
 for(const s of sources) {
  if (isReadOnlyTool(s.parsed)) continue;
  if (/env:(?:ANTIGRAVITY_TARGET_FILE|TARGET_FILE)/.test(s.label || '')) add(s.text);
  else visit(s.parsed ?? s.text);
 }
 return [...out];
}
