// The workspace root: the nearest ancestor with package.json AND package-lock.json, skipping any
// candidate sitting directly inside `git_modules/` — a module clone is never a workspace. Each module
// carries its own copy, because a module never imports another module's code.
import fs from 'node:fs';
import path from 'node:path';

export function findWorkspace(from = process.cwd()) {
	for (let d = path.resolve(from); ; d = path.dirname(d)) {
		const inGitModules = path.basename(path.dirname(d)) === 'git_modules';
		if (!inGitModules && fs.existsSync(path.join(d, 'package.json')) && fs.existsSync(path.join(d, 'package-lock.json'))) return d;
		if (path.dirname(d) === d) return null;
	}
}
