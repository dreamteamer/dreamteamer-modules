#!/usr/bin/env node
// dt-nav — the left nav's one command outside the editor and dt web (cr-dt-008).
//
//   npx -p @dreamteamer/protocol@0.2 dt-nav migrate [root] [--json]
//
// migrate  writes a workspace's old nav settings (dreamteamer.navGroups · navOrder · navHidden in its
//          .vscode/settings.json) into nav.yaml, so the nav draws as it did, once: nothing happens when nav.yaml
//          already exists or no setting is set. On an engine that merges module nav fragments (0.49) they are applied
//          after. The engine is the WORKSPACE's own (node_modules/dreamteamer). `root` defaults to the workspace the
//          current folder is in. `--json` prints { written, fragments } instead of the sentence.
//
// Exit 0 when done or nothing to do; 1 on any failure (✖ and the reason); 2 on an unknown subcommand.
import fs from 'node:fs';
import path from 'node:path';
import { findWorkspace } from '../lib/workspace-root.mjs';
import { initEngine } from '../src/host/engine.js';
import { workspaceNavSettings } from '../src/nav-model.js';
import { migrateNavSettings } from '../src/nav-doc.js';

const USAGE = `usage: dt-nav migrate [root] [--json]
  migrate   write this workspace's old nav settings (navGroups, navOrder, navHidden) into nav.yaml, once
`;

const args = process.argv.slice(2);
const json = args.includes('--json');
const [sub, given] = args.filter((a) => a !== '--json');
if (sub === '--help' || sub === '-h' || sub === 'help') {
	process.stdout.write(USAGE);
	process.exit(0);
}
if (sub !== 'migrate') {
	process.stderr.write(`${sub ? `unknown subcommand: ${sub}\n` : ''}${USAGE}`);
	process.exit(2);
}

try {
	const root = given ? path.resolve(given) : findWorkspace();
	if (!root || !fs.existsSync(path.join(root, 'package.json'))) {
		throw new Error(`no workspace at ${given ? path.resolve(given) : process.cwd()} — run it inside a workspace, or name its root`);
	}
	await initEngine(root, { minEngine: '0.43.0' });
	const result = migrateNavSettings(root, workspaceNavSettings(root));
	if (json) console.log(JSON.stringify(result));
	else console.log(result.written ? `✔ nav.yaml written from your nav settings${result.fragments ? ' · fragments applied' : ''}` : 'nothing to migrate');
	process.exit(0);
} catch (e) {
	console.error(`✖ ${String(e?.message ?? e).split('\n')[0]}`);
	process.exit(1);
}
