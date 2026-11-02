#!/usr/bin/env node
// dt-web <workspace root> [url|status|stop] [flags] — dt web without adding a dependency to the workspace.
import fs from 'node:fs';
import path from 'node:path';
import { main } from '../src/cli.js';

const [rootArg, ...rest] = process.argv.slice(2);
const root = path.resolve(rootArg ?? '.');
if (!fs.existsSync(path.join(root, 'package.json'))) {
	console.error(`${root} is not a dreamteamer workspace (no package.json) — npx dreamteamer init`);
	process.exit(2);
}
main(root, rest).then((code) => process.exit(code), (e) => { console.error(`✖ ${e.message}`); process.exit(2); });
