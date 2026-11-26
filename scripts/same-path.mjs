import { realpathSync } from 'node:fs';
import { sep } from 'node:path';

// Windows: git prints the long, forward-slash path (C:/Users/runneradmin/...) while the plugin root may be
// an 8.3 short path (C:\Users\RUNNER~1\...). Only the native realpath expands short names; NTFS paths are
// case-insensitive. POSIX keeps the exact realpath comparison.
const canonical = process.platform === 'win32' ? p => realpathSync.native(p).toLowerCase() : p => realpathSync(p);

/** True when both paths name the same existing directory, e.g. git's --show-toplevel and the plugin root. Throws if either is missing. */
export function samePath(a, b) {
 return canonical(a) === canonical(b);
}

/** True when child is dir itself or lies anywhere below it; a sibling that only shares the name prefix is not. Throws if either is missing. */
export function withinPath(child, dir) {
 const c = canonical(child), d = canonical(dir);
 return c === d || c.startsWith(d.endsWith(sep) ? d : d + sep);
}
