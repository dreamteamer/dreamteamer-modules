#!/usr/bin/env node
// `dt-setup` — ONE RELEASE AS A SHIM. The board this package drew (which optional capability is ready,
// degraded or unavailable) and the edits its `setup` verb made are the engine's own since
// dreamteamer 0.47: every module declares its setup as a unit, `dt status` is the board and
// `dt setup <unit>` the repair (CR-dt-006). The two old verbs print where they went and run the
// engine's; `link`, `unlink` and `guard` — previewing a local clone of dreamteamer-modules — stay
// here, they were never about setup.
//
//   npx dt-setup doctor [--strict] [--json]   → dt status (and dt doctor --strict with --strict)
//   npx dt-setup setup [<unit>] …             → dt setup …
//   npx dt-setup link <clone> | unlink        preview a local clone in place of the published modules
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { findWorkspace } from '../lib/capabilities.mjs';

const args = process.argv.slice(2);
const verb = args.find((a) => !a.startsWith('-')) ?? 'doctor';
const root = findWorkspace();
if (!root) {
	console.error('Not inside a dreamteamer workspace.\nRun this from the workspace that installed the package — the folder with package.json and package-lock.json.');
	process.exit(2);
}

if (verb === 'link' || verb === 'unlink' || verb === 'guard') {
	const { main } = await import('./link.mjs');
	process.exit(await main(args.filter((a) => a !== verb), root, verb));
}

const engine = path.join(root, 'node_modules', 'dreamteamer', 'bin', 'dreamteamer.js');
const dt = (dtArgs) => spawnSync(process.execPath, [engine, ...dtArgs], { cwd: root, stdio: 'inherit' }).status ?? 1;
const engineVersion = () => { try { return JSON.parse(fs.readFileSync(path.join(root, 'node_modules', 'dreamteamer', 'package.json'), 'utf8')).version; } catch { return null; } };
const floor = (v) => { const m = /^(\d+)\.(\d+)\.(\d+)/.exec(v ?? ''); return m && (Number(m[1]) > 0 || Number(m[2]) >= 47); };

if (verb === 'doctor' || verb === 'setup') {
	if (!fs.existsSync(engine)) { console.error('✖ no engine under node_modules/dreamteamer — npm install first'); process.exit(2); }
	if (!floor(engineVersion())) {
		console.error(`✖ dt-setup ${verb} is now the engine's own — dt status and dt setup <unit> — and this workspace runs dreamteamer ${engineVersion() ?? '?'}, before 0.47. Upgrade on purpose (npm install --save-exact dreamteamer@latest, then dt compile), or keep @dreamteamer/setup 0.2.1 for the old board.`);
		process.exit(2);
	}
	const rest = args.filter((a) => a !== verb);
	if (verb === 'doctor') {
		console.error('— dt-setup doctor is `dt status` now (the setup section is the board) and `dt doctor` for the rows; this package is a shim for one release.');
		const code = dt(['status', ...rest.filter((a) => a === '--json')]);
		process.exit(rest.includes('--strict') ? dt(['doctor', '--strict', ...rest.filter((a) => a === '--json')]) : code);
	}
	console.error('— dt-setup setup is `dt setup [<unit>] [--input id=value]… [--allow <kind>]…` now; this package is a shim for one release.');
	process.exit(dt(['setup', ...rest]));
}

console.error(`unknown command "${verb}" — expected doctor, setup, link, unlink or guard. The other verbs moved to their modules: npx dt-wiki · npx dt-notebook · npx dt-find`);
process.exit(2);
