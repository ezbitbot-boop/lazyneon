#!/usr/bin/env node
// Explicit files work on Node 20–25 and Windows without shell glob expansion.
import { readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const files = readdirSync(new URL('../test/', import.meta.url))
 .filter(name => name.endsWith('.test.mjs')).sort()
 .map(name => new URL(`../test/${name}`, import.meta.url));
if (!files.length) throw new Error('No tests found');
const result = spawnSync(process.execPath, ['--test', ...process.argv.slice(2), ...files.map(file => fileURLToPath(file))], { stdio: 'inherit' });
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
