#!/usr/bin/env node
// The extension's test runner. Same shape and same reporter as the engine's, deliberately.
//
//   npm test                   tier 1 (test/unit) + the webview render tier (test/webview), no VS Code
//   npm test -- --only=nav      one file, whichever directory it is in
//   npm test -- --verbose       node's spec reporter
//   npm run typecheck          types (esbuild does not check them; neither does this)
//   npm run test:ui            tier 3: boots a real VS Code host — macOS only, see below
//
// WHY A TIER 1 EXISTS HERE AT ALL: the only test this repo had was `npm run smoke`, which builds the
// bundle, launches an Extension Development Host and drives it over CDP. That proves the tree renders,
// and the one failure mode CLAUDE.md documents — a deleted engine module emptying the view — is
// invisible to anything cheaper, so it is worth keeping. But it costs ~30s, needs a GUI, and
// `scripts/launch.mjs` hardcodes `/Applications/...` paths: it runs on a macOS workstation and nowhere
// else. Not in a container, not in CI.
//
// So the LOGIC moves down a tier, into modules that hold no editor API: `fsdata.ts` (paths, parsing,
// file↔record mapping), `nav.ts` (which folder a collection appears under), `titles.ts` (route → record).
//
// esbuild rather than Node's --experimental-strip-types, for two reasons discovered in that order:
// `tree.ts` uses TypeScript parameter properties, which strip-only mode refuses outright, and the
// source uses extensionless relative imports, which Node's ESM resolver refuses. esbuild is already a
// dependency for the real build and handles both in ~50ms, so testing needs no new tool.
import { spawnSync } from 'node:child_process';
import { readdirSync, existsSync, readFileSync, rmSync, mkdirSync } from 'node:fs';
import { resolve, dirname, join, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';
import * as sfc from 'vue/compiler-sfc';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const flag = (n) => args.includes(`--${n}`);
const value = (n) => args.find((a) => a.startsWith(`--${n}=`))?.split('=').slice(1).join('=');

const only = value('only');

function testFiles(dir) {
	if (!existsSync(dir)) return [];
	return readdirSync(dir)
		.filter((f) => f.endsWith('.test.ts'))
		.sort()
		.map((f) => join(dir, f))
		.filter((f) => !only || f.includes(only));
}

const unitEntries = testFiles(join(ROOT, 'test', 'unit'));
const webviewEntries = testFiles(join(ROOT, 'test', 'webview'));

if (!unitEntries.length && !webviewEntries.length) {
	console.error(only ? `✖ no test files match --only=${only}` : '✖ no test files found');
	process.exit(1);
}

const outDir = join(ROOT, '.test-build');
rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });

// One bundle per test file, with the src modules under test inlined. `vscode` is stubbed to an empty
// object: a module that genuinely needs the editor API has no business in this tier, and a stub makes
// that a clear failure at the call site rather than a resolver error before anything runs.
//
// `.vue` is stubbed the same way and for the same reason. A webview module worth testing here holds
// no component — but its MODULE GRAPH reaches one anyway (`ui-views.ts` names the page components
// its routes render), and esbuild refuses an SFC it has no loader for, so a pure composable was
// untestable for a reason that had nothing to do with the composable. Rendering is tier 3's job; a
// stub component turns "this test accidentally renders" into an obvious failure where it happens.
const stubVscode = {
	name: 'stub-vscode',
	setup(build) {
		build.onResolve({ filter: /^vscode$/ }, () => ({ path: 'vscode', namespace: 'stub' }));
		build.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({ contents: 'export default {};', loader: 'js' }));
	},
};

const common = {
	// .mjs so Node does not have to guess the module type of a bundle in a CJS package (the extension
	// itself ships CJS for VS Code, so package.json cannot say "type": "module")
	outExtension: { '.js': '.mjs' },
	bundle: true,
	platform: 'node',
	format: 'esm',
	target: 'node20',
	sourcemap: 'inline',
	external: ['node:*'],
};

if (unitEntries.length) {
	await esbuild.build({
		...common,
		entryPoints: unitEntries,
		outdir: join(outDir, 'unit'),
		plugins: [stubVscode, {
			name: 'stub-vue-sfc',
			setup(build) {
				build.onLoad({ filter: /\.vue$/ }, ({ path }) => ({
					contents: `export default { name: ${JSON.stringify(basename(path))}, render() { throw new Error('tier 1 does not render components — ${basename(path)}'); } };`,
					loader: 'js',
				}));
			},
		}],
	});
}

// ---- TIER 2: the webview RENDER tier -----------------------------------------------------------
// Same runner, one difference that is the whole point: `.vue` is COMPILED rather than stubbed, and
// `api/transport` resolves to `test/webview/host-stub.ts` so a test answers the host. See
// `test/webview/render.ts` for why the tier exists — tier 1 cannot see a control and tier 3 runs
// where no control exists, so nothing asserted what a button actually renders, and a live defect
// (Restore offered on a compiled record, its refusal swallowed) sat under a green suite.
if (webviewEntries.length) {
	await esbuild.build({
		...common,
		entryPoints: webviewEntries,
		outdir: join(outDir, 'webview'),
		plugins: [stubVscode, {
			name: 'vue-sfc',
			setup(build) {
				build.onLoad({ filter: /\.vue$/ }, ({ path }) => {
					const { descriptor } = sfc.parse(readFileSync(path, 'utf8'), { filename: path });
					const id = basename(path);
					if (!descriptor.script && !descriptor.scriptSetup) {
						const template = sfc.compileTemplate({ source: descriptor.template?.content ?? '', filename: path, id });
						return { contents: `${template.code}\nexport default { render };`, loader: 'ts' };
					}
					// `inlineTemplate` keeps the render function closed over the setup bindings, which is
					// what makes a `<script setup>` ref reactive without a binding-metadata round trip.
					const compiled = sfc.compileScript(descriptor, { id, inlineTemplate: !!descriptor.template });
					return {
						contents: `${compiled.content.replace(/export default/, 'const __sfc__ =')}\nexport default __sfc__;`,
						loader: 'ts',
					};
				});
			},
		}, {
			name: 'host-stub',
			setup(build) {
				const stub = join(ROOT, 'test', 'webview', 'host-stub.ts');
				build.onResolve({ filter: /(^|\/)transport$/ }, () => ({ path: stub }));
			},
		}],
	});
}

const built = [
	...unitEntries.map((e) => join('.test-build', 'unit', basename(e).replace(/\.ts$/, '.mjs'))),
	...webviewEntries.map((e) => join('.test-build', 'webview', basename(e).replace(/\.ts$/, '.mjs'))),
];
const reporter = flag('verbose') ? 'spec' : join(ROOT, 'scripts', 'test-reporter.mjs');
const res = spawnSync(process.execPath, ['--test', `--test-reporter=${reporter}`, ...built], {
	cwd: ROOT,
	stdio: 'inherit',
});
process.exit(res.status ?? 1);
