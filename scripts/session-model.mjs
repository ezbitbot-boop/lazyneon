import fs from 'node:fs';
import path from 'node:path';
import { resolveWorkspace } from './workspace-path.mjs';
function reportedModel(payload = {}, env = process.env) {
	const candidates = [
		payload.modelName,
		payload.model_name,
		payload.sessionModel,
		payload.session_model,
		payload.model,
		payload.session?.modelName,
		payload.session?.model,
		env.ANTIGRAVITY_MODEL_NAME,
		env.ANTIGRAVITY_MODEL,
	];
	for (const c of candidates) {
		if (typeof c === "string" && c.trim()) return c.trim();
	}
	return null;
}
export function sessionModel(payload = {}, env = process.env) {
 return reportedModel(payload, env) ?? "unknown";
}


// Host reports are shared with subsequent CLI processes in this workspace.
// A new SessionStart always replaces the previous report, including unknown.
const statePath = payload => path.join(resolveWorkspace(payload), '.lazyneon', 'session-model.json');
export function rememberSessionModel(payload = {}, env = process.env) {
 const model = sessionModel(payload, env);
 const file = statePath(payload);
 fs.mkdirSync(path.dirname(file), {recursive:true});
 fs.writeFileSync(file, JSON.stringify({model, conversationId:payload.conversationId ?? payload.sessionId ?? null, recordedAt:Date.now()}), {mode:0o600});
 return model;
}
export function resolveSessionModel(payload = {}, env = process.env) {
 const direct = reportedModel(payload, env);
 if (direct !== null) return direct;
 try {
  const state = JSON.parse(fs.readFileSync(statePath(payload), 'utf8'));
  const id = payload.conversationId ?? payload.sessionId;
  if (id && id !== state.conversationId) return 'unknown';
  if (!Number.isFinite(state.recordedAt) || Date.now()-state.recordedAt > 24*60*60*1000 || state.recordedAt > Date.now()) return 'unknown';
  return typeof state.model === 'string' && state.model.trim() ? state.model.trim() : 'unknown';
 } catch { return 'unknown'; }
}
