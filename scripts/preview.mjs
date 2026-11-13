#!/usr/bin/env node
// PREVIEW THIS REPO IN A WORKSPACE — run from the consumer workspace, naming this clone (cr-dt-007, D70:
// the setup package is gone; the bundle preview it carried stays a script of this repo, as the change
// request's non-goals said it would):
//
//   node <clone>/scripts/preview.mjs link <clone>   symlink git_modules/dreamteamer-modules → the clone, recompile
//   node <clone>/scripts/preview.mjs unlink         remove it, recompile
//   node <clone>/scripts/preview.mjs link           say which is live
//   node <clone>/scripts/preview.mjs guard          the pre-commit guard the link installs runs this
//
// One module at a time needs none of this: `dt install ./path/to/module` previews it through the engine.
import fs from 'node:fs';
import path from 'node:path';

/** The workspace root: the nearest ancestor holding package.json with a `dreamteamer` block. */
function findWorkspace(from = process.cwd()) {
	for (let dir = path.resolve(from); ; dir = path.dirname(dir)) {
		try { if (JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8')).dreamteamer) return dir; } catch { /* keep climbing */ }
		if (path.dirname(dir) === dir) return null;
	}
}

const args = process.argv.slice(2);
const verb = args.find((a) => !a.startsWith('-')) ?? 'link';
if (!['link', 'unlink', 'guard'].includes(verb)) {
	console.error(`unknown command "${verb}" — expected link, unlink or guard`);
	process.exit(2);
}
const root = findWorkspace();
if (!root) {
	console.error('Not inside a dreamteamer workspace.\nRun this from the workspace that should preview the clone — the folder with package.json.');
	process.exit(2);
}
const { main } = await import('./preview/link-cli.mjs');
process.exit(await main(args.filter((a) => a !== verb), root, verb));
