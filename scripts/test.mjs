#!/usr/bin/env node
// The test runner. Zero dependencies — it collects the files and hands them to `node --test`.
//
// ⚠ WHY A SCRIPT AND NOT A GLOB IN package.json. `node --test "tests/*.test.mjs"` expands the
// pattern only on Node 22+; on Node 20 the argument is a literal path and the run dies with
// `Could not find '…/tests/*.test.mjs'` — exit 1, no tests run, and a matrix row that is red for a
// reason nothing about this package explains. Measured in CI on 2026-09-09: node 22 green, node 20
// red on that line alone. The engine declares `engines.node >= 20`, so 20 is a version consumers
// actually run and dropping it from the matrix would have hidden the problem rather than fixed it.
//
//   node scripts/test.mjs                  every suite
//   node scripts/test.mjs --only=leak      just the files whose path contains "leak"
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const only = process.argv.slice(2).find((a) => a.startsWith('--only='))?.slice('--only='.length);

/** Every `*.test.mjs` under `dir`, skipping installed and generated trees. */
function collect(dir, out = []) {
	if (!fs.existsSync(dir)) return out;
	for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
		if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
		const p = path.join(dir, e.name);
		if (e.isDirectory()) collect(p, out);
		else if (e.name.endsWith('.test.mjs')) out.push(p);
	}
	return out;
}

const files = [...collect(path.join(ROOT, 'tests')), ...collect(path.join(ROOT, 'modules'))]
	.filter((f) => !only || f.includes(only))
	.sort();

// ⚠ A pin that matches nothing passes vacuously, which is the one outcome to avoid in a runner that
// derives its own input: an empty list makes `node --test` exit 0 having run nothing.
if (!files.length) {
	console.error(only ? `no test files match --only=${only}` : 'no test files found — the collector is broken, not the suite');
	process.exit(1);
}

console.log(`${files.length} test files`);
const r = spawnSync(process.execPath, ['--test', ...files], { stdio: 'inherit', cwd: ROOT });
process.exit(r.status ?? 1);
