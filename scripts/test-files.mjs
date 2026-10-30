// Which test files a run executes — collected once, then narrowed by module, by substring and by shard.
// Split from test.mjs so `tests/test-shards.test.mjs` can prove the partition without spawning a run.
//
// ⚠ THE ONE PROPERTY THAT MATTERS: across the shards of one run, every collected file runs EXACTLY
// once. A file no shard picks passes silently in every job, which is worse than a red build. The
// weights below only BALANCE the shards; a stale or missing weight costs wall time, never coverage.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Every `*.test.mjs` and `*.test.js` under `dir`, skipping installed and generated trees. */
function walk(dir, out = []) {
	if (!fs.existsSync(dir)) return out;
	for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
		if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
		const p = path.join(dir, e.name);
		if (e.isDirectory()) walk(p, out);
		else if (e.name.endsWith('.test.mjs') || e.name.endsWith('.test.js')) out.push(p);
	}
	return out;
}

/** Every test file in the repo, as sorted root-relative POSIX paths. */
export function collect(root = ROOT) {
	return [...walk(path.join(root, 'tests')), ...walk(path.join(root, 'modules'))]
		.map((f) => path.relative(root, f).split(path.sep).join('/'))
		.sort();
}

/**
 * The files a module's release runs: the repo-wide checks under `tests/` (structure, leak gate, and
 * compiles-alone, which installs EVERY module from its packed tarball) plus that module's own suite.
 */
export function forModule(files, id) {
	return files.filter((f) => f.startsWith('tests/') || f.startsWith(`modules/${id}/`));
}

// Seconds per file on a 2-vCPU GitHub runner, node 20, run 41100010853 (2026-10-30): the files above
// ~8 s. Everything else counts DEFAULT_WEIGHT. Re-measure when a shard runs far longer than the rest.
export const WEIGHTS = {
	'modules/proofs/test/integration/prove.test.js': 170,
	'modules/worktrees/test/integration/land.test.js': 65,
	'tests/compiles-alone.test.mjs': 65,
	'modules/files/test/sync.test.mjs': 45,
	'modules/worktrees/test/integration/worktrees.test.js': 36,
	'modules/rnd/test/prototype-play.test.mjs': 21,
	'modules/notebooklm/test/export.test.mjs': 20,
	'modules/notebooklm/test/sync.test.mjs': 16,
	'modules/rnd/test/heldout/play-fails-honestly.test.mjs': 15,
	'tests/interplay.test.mjs': 14,
	'modules/proofs/test/integration/extension.test.js': 12,
	'modules/setup/test/capabilities.test.mjs': 12,
	'modules/rnd/test/prototype-packed.test.mjs': 10,
	'modules/workflows/test/install.test.mjs': 9,
	'modules/rnd/test/prototype-schema.test.mjs': 9,
	'tests/proofs-with-worktrees.test.mjs': 8,
	'modules/rnd/test/heldout/minimal-app-contract.test.mjs': 8,
};
export const DEFAULT_WEIGHT = 2;

/**
 * A file drives a real browser when its source names one. rnd's prototype harness fails honestly
 * rather than skipping when no Chromium resolves, so a browser file missed here goes RED in CI — the
 * heuristic can cost a rerun, never a silent pass.
 */
export function needsBrowser(file, root = ROOT) {
	return /playwright|chromium/i.test(fs.readFileSync(path.join(root, file), 'utf8'));
}

/**
 * Shard `index` (1-based) of `total`: longest-first greedy bin packing over WEIGHTS, ties broken by
 * path, so every machine computes the same partition from the same file list. The browser files are
 * placed first, together, so only ONE shard pays for a Chromium install.
 */
export function shard(files, index, total, { browser = (f) => needsBrowser(f) } = {}) {
	if (!Number.isInteger(total) || total < 1) throw new Error(`shard total must be a positive integer, got ${total}`);
	if (!Number.isInteger(index) || index < 1 || index > total) throw new Error(`shard index must be 1..${total}, got ${index}`);
	const weight = (f) => WEIGHTS[f] ?? DEFAULT_WEIGHT;
	const byWeight = (a, b) => weight(b) - weight(a) || (a < b ? -1 : a > b ? 1 : 0);
	const bins = Array.from({ length: total }, () => ({ load: 0, files: [] }));
	const lightest = () => bins.reduce((best, b) => (b.load < best.load ? b : best), bins[0]);
	const browserFiles = files.filter(browser);
	if (browserFiles.length) {
		const b = lightest();
		for (const f of browserFiles) b.files.push(f), (b.load += weight(f));
	}
	for (const f of files.filter((f) => !browserFiles.includes(f)).sort(byWeight)) {
		const b = lightest();
		b.load += weight(f);
		b.files.push(f);
	}
	return bins[index - 1].files.sort();
}
