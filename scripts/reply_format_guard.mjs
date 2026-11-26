#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { isMainModule } from './is-main.mjs';
import { readStdin } from './read-stdin.mjs';

// Style hints are ephemeral and never request Stop continuation or write state.
export function proseOnly(text) {
 let fence = null;
 return text.split(/\r?\n/).filter(line => {
  const marker = line.match(/^\s{0,3}(`{3,}|~{3,})/);
  if (marker) {
   if (!fence) fence = marker[1];
   else if (marker[1][0] === fence[0] && marker[1].length >= fence.length && /^\s*$/.test(line.slice(marker[0].length))) fence = null;
   return false;
  }
  return !fence && !/^(?: {4}|\t)/.test(line);
 }).join('\n').replace(/(`+)[\s\S]*?\1/g, '');
}
export function replyIssues(message, producedFiles = false) {
 const text = proseOnly(message).trim();
 if (!/[가-힣]/.test(text)) return [];
 const issues = [];
 if (/혁신적인|다면적인|심리스한|중추적인/.test(text)) issues.push('AI 상투어를 구체적인 표현으로 수정');
 if (/[가-힣]+(?:고|며|지만),/.test(text)) issues.push('연결어미 뒤 쉼표 확인');
 if (/\p{Extended_Pictographic}|\p{Regional_Indicator}|[0-9#*]\uFE0F?\u20E3/u.test(text)) issues.push('장식 이모지 제거');
 if (/^(?:좋은 질문(?:입니다|이에요)|훌륭한 질문|물론입니다|지금부터.{0,40}살펴보겠습니다|요청하신 내용을.{0,30}정리해 드리겠습니다)/.test(text)) issues.push('샌드위치 도입 제거');
 const last = text.split('\n').filter(s => s.trim()).at(-1) ?? '';
 if (/(?:도움이 되셨길|도움이 되었기를|궁금한 점이.{0,30}(?:알려|문의)|결론적으로 정리하면)/.test(last)) issues.push('샌드위치 마무리 제거');
 if (producedFiles && !(last.length <= 140 && /(?:확인|열어|실행|검토|사용|참고|읽어).*(?:하세요|하십시오|바랍니다|됩니다)/.test(last))) issues.push('산출물 사용법을 마지막 안내 한 줄로 추가');
 return issues.slice(0, 3);
}
function tail(file, bytes = 32 * 1024) {
 const fd = fs.openSync(file, 'r');
 try {
  const size = fs.fstatSync(fd).size;
  const start = Math.max(0, size - bytes);
  const buf = Buffer.alloc(size - start);
  fs.readSync(fd, buf, 0, buf.length, start);
  const text = buf.toString('utf8');
  return start ? text.slice(text.indexOf('\n') + 1) : text;
 } finally { fs.closeSync(fd); }
}
function records(payload) {
 const candidates = [payload.transcriptPath, payload.transcript_path];
 const dir = payload.artifactDirectoryPath ?? payload.artifact_directory_path;
 if (dir) candidates.push(path.join(dir, '.system_generated/logs/transcript_full.jsonl'));
 for (const file of candidates.filter(p => typeof p === 'string' && p)) {
  try {
   let lines = tail(file).split('\n');
   if (!lines.some(l => /"(?:USER|user|USER_MESSAGE|USER_INPUT)"/.test(l))) lines = tail(file, 512 * 1024).split('\n');
   return lines.flatMap(line => { try { return [JSON.parse(line)]; } catch { return []; } });
  } catch { /* Unreadable transcript must not interfere with Stop. */ }
 }
 return [];
}
function textOf(record) {
 const content = record.message?.content ?? record.content;
 if (typeof content === 'string') return content;
 return Array.isArray(content) ? content.filter(c => c.type === 'text').map(c => c.text).join('\n') : '';
}
function isUser(record) {
 return record.role === 'user' || record.message?.role === 'user' || ['USER_MESSAGE', 'USER_INPUT'].includes(record.type) || record.source === 'USER';
}
function isAssistant(record) {
 return record.role === 'assistant' || record.message?.role === 'assistant' || record.type === 'PLANNER_RESPONSE' || record.source === 'MODEL';
}
function writesFile(record) {
 if (record.is_error || record.error || record.status === 'error') return false;
 const calls = record.tool_calls ?? record.toolCalls ?? (record.toolCall ? [record.toolCall] : []);
 const content = record.message?.content ?? record.content;
 const blocks = Array.isArray(content) ? content.filter(c => c.type === 'tool_use') : [];
 return [...calls, ...blocks, record].some(c => /^(?:write_file|write_to_file|Write|WriteFile|edit_file|Edit|replace_file_content|multi_replace_file_content|apply_patch)$/.test(c.name ?? c.tool_name ?? c.toolName ?? c.function?.name ?? ''));
}
export function guardReply(payload, env = process.env) {
 if (String(env.LAZYNEON_REPLY_GUARD).trim().toLowerCase() === 'off' || payload.stop_hook_active || payload.executionNum > 0) return {};
 const all = records(payload);
 const boundary = all.findLastIndex(isUser);
 const turn = boundary >= 0 ? all.slice(boundary + 1) : [];
 const message = payload.last_assistant_message ?? payload.lastAssistantMessage ?? textOf(turn.findLast(isAssistant) ?? {});
 if (typeof message !== 'string') return {};
 const files = (Array.isArray(payload.produced_files) && payload.produced_files.length > 0) || turn.some(writesFile);
 const issues = replyIssues(message, files);
 return issues.length ? { injectSteps: [{ ephemeralMessage: `한국어 답변 점검: ${issues.join('; ')}` }] } : {};
}
if (isMainModule(import.meta.url)) {
 let result = {};
 try { result = guardReply(JSON.parse(await readStdin())); } catch { /* Warn-only hooks fail open. */ }
 // Exit once flushed: a host that keeps stdin open would otherwise hold the hook until its timeout.
 process.stdout.write(JSON.stringify(result) + '\n', () => process.exit(0));
}
