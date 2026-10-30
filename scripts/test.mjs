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
//   node scripts/test.mjs --module=users   tests/ (the repo-wide checks) + modules/users — a release
//   node scripts/test.mjs --shard=2/4      the second of four balanced shards (scripts/test-files.mjs)
//   node scripts/test.mjs --list           print the selected files and run nothing
//   node scripts/test.mjs --needs-browser  print true when a selected file drives Chromium, else false
//   node scripts/test.mjs --concurrency=3  files run at once (default: every CPU, at least 2)
//
// ⚠ WHY AN EXPLICIT CONCURRENCY. `node --test` defaults to availableParallelism() - 1, and a private
// repo's GitHub runner has 2 vCPUs — so CI ran ONE file at a time: the sum of the top-level test
// durations (674 s) was the whole run (725 s), node 20, run 41100010853. Most of these files wait on
// git, npm and dt subprocesses rather than burning CPU, so two at a time on two cores is not a loss.
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import { ROOT, collect, forModule, needsBrowser, shard } from './test-files.mjs';

const arg = (name) => process.argv.slice(2).find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const only = arg('only');
const mod = arg('module');
const shardArg = arg('shard');
const list = process.argv.includes('--list');
const browserQuery = process.argv.includes('--needs-browser');
const concurrency = Number(arg('concurrency') ?? Math.max(2, os.availableParallelism()));

let files = collect();
if (mod) files = forModule(files, mod);
if (only) files = files.filter((f) => f.includes(only));
if (shardArg) {
	const m = /^(\d+)\/(\d+)$/.exec(shardArg);
	if (!m) {
		console.error(`--shard takes <index>/<total>, e.g. --shard=2/4 — got ${shardArg}`);
		process.exit(1);
	}
	files = shard(files, Number(m[1]), Number(m[2]));
}

// ⚠ A pin that matches nothing passes vacuously, which is the one outcome to avoid in a runner that
// derives its own input: an empty list makes `node --test` exit 0 having run nothing.
if (!files.length) {
	const why = [only && `--only=${only}`, mod && `--module=${mod}`, shardArg && `--shard=${shardArg}`].filter(Boolean).join(' ');
	console.error(why ? `no test files match ${why}` : 'no test files found — the collector is broken, not the suite');
	process.exit(1);
}

if (list) {
	console.log(files.join('\n'));
	process.exit(0);
}
if (browserQuery) {
	console.log(String(files.some((f) => needsBrowser(f))));
	process.exit(0);
}

if (!Number.isInteger(concurrency) || concurrency < 1) {
	console.error(`--concurrency takes a positive integer — got ${arg('concurrency')}`);
	process.exit(1);
}

console.log(`${files.length} test files, ${concurrency} at a time${shardArg ? `, shard ${shardArg}` : ''}${mod ? `, module ${mod}` : ''}`);
const r = spawnSync(process.execPath, ['--test', `--test-concurrency=${concurrency}`, ...files], { stdio: 'inherit', cwd: ROOT });
process.exit(r.status ?? 1);
