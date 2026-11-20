import path from 'node:path';

/** Host workspace takes precedence over the hook process/launcher cwd. */
export function resolveWorkspace(payload = {}, fallback = process.cwd()) {
 return [Array.isArray(payload?.workspacePaths) ? payload.workspacePaths[0] : null, payload?.cwd]
  .find(value => typeof value === 'string' && path.isAbsolute(value)) || fallback;
}
