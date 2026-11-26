import { realpathSync } from 'node:fs';

// Windows: git prints the long, forward-slash path (C:/Users/runneradmin/...) while the plugin root may be
// an 8.3 short path (C:\Users\RUNNER~1\...). Only the native realpath expands short names; NTFS paths are
// case-insensitive. POSIX keeps the exact realpath comparison.
const canonical = process.platform === 'win32' ? p => realpathSync.native(p).toLowerCase() : p => realpathSync(p);

/** True when both paths name the same existing directory, e.g. git's --show-toplevel and the plugin root. Throws if either is missing. */
export function samePath(a, b) {
 return canonical(a) === canonical(b);
}
