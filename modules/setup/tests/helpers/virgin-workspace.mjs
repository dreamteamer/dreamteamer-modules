// A VIRGIN WORKSPACE ON THE PINNED ENGINE — the only instrument in this repo that measures anything.
//
// ⚠ Read this before writing a test that does not use it. Four times during the 0.2.0 work a fully
// green suite proved nothing, always the same way: a fixture and the script it exercised had drifted
// together, so the two agreed and neither matched the descriptors. Five defects came out of running
// the real engine instead — including a reader that silently dropped judged summaries, and a whole
// stage whose records `check` refused while its own tests passed.
//
// The engine here is the devDependency, which is exactly what a consumer installs. A module that
// only works against an unreleased engine fails here first.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert';
import { execFileSync, spawnSync } from 'node:child_process';

export const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..');
export const MODULES = path.join(ROOT, 'modules');
export const ENGINE = path.join(ROOT, 'node_modules', 'dreamteamer');
export const BIN = path.join(ENGINE, 'bin', 'dreamteamer.js');

const GIT_ENV = {
	...process.env,
	GIT_AUTHOR_NAME: 'probe', GIT_AUTHOR_EMAIL: 'probe@example.invalid',
	GIT_COMMITTER_NAME: 'probe', GIT_COMMITTER_EMAIL: 'probe@example.invalid',
};

/** Run the pinned engine in `cwd`. Returns the spawn result — callers assert on status themselves. */
export const run = (cwd, args) => spawnSync(process.execPath, [BIN, ...args], { cwd, encoding: 'utf8', env: GIT_ENV });

export const pkgOf = (m) => JSON.parse(fs.readFileSync(path.join(MODULES, m, 'package.json'), 'utf8'));

/** A module plus everything it transitively declares as a hard dependency. */
export function closure(m, acc = new Set()) {
	if (acc.has(m)) return acc;
	acc.add(m);
	for (const d of pkgOf(m).dreamteamer.dependencies ?? []) closure(d, acc);
	return acc;
}

/** A fresh `dreamteamer init` workspace with the three template variables declared and set. */
export function virginWorkspace() {
	assert.ok(fs.existsSync(BIN), 'run npm install first — the engine devDependency is the gate');
	const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ext-ws-'));
	execFileSync('git', ['init', '-q'], { cwd: root });
	fs.mkdirSync(path.join(root, 'node_modules'));
	fs.symlinkSync(ENGINE, path.join(root, 'node_modules', 'dreamteamer'), 'dir');
	fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'probe', private: true, dependencies: { dreamteamer: '*' } }, null, '\t'));
	const init = run(root, ['init', '--name', 'probe']);
	assert.equal(init.status, 0, init.stderr + init.stdout);
	const pkgPath = path.join(root, 'package.json');
	const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
	pkg.dreamteamer.vars = ['FILES_FOLDER', 'INBOX_FOLDERS', 'REPOS_FOLDER'];
	fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, '\t') + '\n');
	fs.writeFileSync(path.join(root, '.env'), `FILES_FOLDER=${root}/files\nINBOX_FOLDERS=${root}/inbox\nREPOS_FOLDER=${root}\n`);
	return root;
}

const NEVER_COPY = /node_modules|\.models|\.cache|__pycache__/;

/** Copy modules in, without their build leftovers. */
export function installModules(root, names) {
	for (const m of names) fs.cpSync(path.join(MODULES, m), path.join(root, 'modules', m), { recursive: true, filter: (src) => !NEVER_COPY.test(src) });
}
