import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/** Compare physical paths so linked plugin installations execute their entrypoints. */
export function isMainModule(url, entry = process.argv[1]) {
 if (!entry) return false; // Import from an eval/REPL has no entrypoint.
 try {
  return realpathSync(entry) === realpathSync(fileURLToPath(url));
 } catch (cause) {
  throw new Error(`Cannot resolve main module: ${entry}`, { cause });
 }
}
