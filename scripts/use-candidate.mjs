#!/usr/bin/env node
// THE CANDIDATE ENGINE IN PLACE — before an engine is published, this repo's suites run on it, never
// skipped (D60). `node scripts/use-candidate.mjs <folder> [--root <repo>]`:
//
//   <folder> holds exactly one `dreamteamer-<version>.tgz` and a `SHA256SUMS` (the `shasum -c` format).
//   The tarball is verified against its listed hash, then extracted OVER `<repo>/node_modules/dreamteamer`
//   — so `import 'dreamteamer/testing'`, the helpers' ENGINE and every spawned `dt` are the candidate.
//   The engine's own dependencies are the ones this repo's `npm ci` already installed beside it (a
//   candidate needing one that is not there is a refusal, naming it). `package.json` and the lockfile are
//   never touched; `npm ci` puts the published devDependency back.
//
// A missing file, a wrong hash or a tarball that is not the engine is a refusal (exit 1) — a green suite
// on the wrong engine proves nothing. CI makes the folder by packing the engine repository at the
// commit `candidates/engine.json` pins (D72); locally, any folder with the tarball and its sums.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const argv = process.argv.slice(2);
const flag = (n) => { const i = argv.indexOf(`--${n}`); return i > -1 ? argv[i + 1] : null; };
const root = path.resolve(flag('root') ?? path.join(path.dirname(fileURLToPath(import.meta.url)), '..'));
const folderArg = argv.find((a, i) => !a.startsWith('--') && argv[i - 1] !== '--root') ?? process.env.DT_CANDIDATES;
const die = (m) => { console.error(`✖ ${m}`); process.exit(1); };

if (!folderArg) die('use-candidate takes a folder holding dreamteamer-<version>.tgz and SHA256SUMS (or DT_CANDIDATES)');
const folder = path.resolve(folderArg);
const tgz = fs.existsSync(folder) ? fs.readdirSync(folder).filter((f) => /^dreamteamer-\d+\.\d+\.\d+.*\.tgz$/.test(f)).sort() : [];
if (tgz.length !== 1) die(`${folder}: expected exactly one dreamteamer-<version>.tgz there (found ${tgz.length ? tgz.join(', ') : 'none'})`);
const file = path.join(folder, tgz[0]);
const sums = path.join(folder, 'SHA256SUMS');
if (!fs.existsSync(sums)) die(`${folder}: no SHA256SUMS beside ${tgz[0]} — refusing an unverified candidate`);
const listed = fs.readFileSync(sums, 'utf8').split('\n').map((l) => /^([0-9a-f]{64})\s+\*?(.+)$/.exec(l.trim())).filter(Boolean).find((m) => m[2] === tgz[0])?.[1];
const actual = createHash('sha256').update(fs.readFileSync(file)).digest('hex');
if (!listed) die(`${folder}: SHA256SUMS has no line for ${tgz[0]}`);
if (listed !== actual) die(`${tgz[0]} is ${actual}, SHA256SUMS says ${listed} — refusing a candidate that is not the one hashed`);

const staging = fs.mkdtempSync(path.join(os.tmpdir(), 'dtm-use-candidate-'));
try {
	execFileSync('tar', ['-xzf', file, '-C', staging]);
	const pkg = JSON.parse(fs.readFileSync(path.join(staging, 'package', 'package.json'), 'utf8'));
	if (pkg.name !== 'dreamteamer') die(`${tgz[0]} holds ${pkg.name}, not the engine`);
	const missing = Object.keys(pkg.dependencies ?? {}).filter((d) => !fs.existsSync(path.join(root, 'node_modules', d, 'package.json')));
	if (missing.length) die(`the candidate depends on ${missing.join(', ')}, which this repo's npm install does not hold — run npm ci`);
	const target = path.join(root, 'node_modules', 'dreamteamer');
	fs.rmSync(target, { recursive: true, force: true });
	fs.cpSync(path.join(staging, 'package'), target, { recursive: true });
	console.log(`✔ node_modules/dreamteamer is the candidate ${pkg.version} (sha256 ${actual.slice(0, 16)}…)`);
} finally {
	fs.rmSync(staging, { recursive: true, force: true });
}
