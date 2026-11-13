// What is left of the capabilities board: the one helper the shim's bin still needs. The board, its
// legacy rows and the provider OWNERSHIP map are gone — since dreamteamer 0.47 every module declares
// its setup as a unit and the engine draws the board (`dt status`, `dt doctor`), so a central catalog
// of who owns which check has nothing left to say (CR-dt-006, decisions D19 and D29).
import fs from 'node:fs';
import path from 'node:path';

/** The workspace root: the nearest ancestor holding package.json with a `dreamteamer` block. */
export function findWorkspace(from = process.cwd()) {
	let dir = path.resolve(from);
	for (;;) {
		try { const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8')); if (pkg.dreamteamer) return dir; } catch { /* keep climbing */ }
		const up = path.dirname(dir);
		if (up === dir) return null;
		dir = up;
	}
}
