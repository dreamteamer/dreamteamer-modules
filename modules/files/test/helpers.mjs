// Shared fixture helpers: a folder tree from a spec, and a workspace with one drive pointed at it.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { workspace } from './fixture.mjs';

/** Write a tree: `{ 'docs/readme.md': '# hi', 'media/clip.m4a': Buffer, 'empty/': null }`. Returns `dir`. */
export function makeTree(dir, spec) {
	for (const [rel, content] of Object.entries(spec)) {
		const p = path.join(dir, rel);
		if (rel.endsWith('/')) { fs.mkdirSync(p, { recursive: true }); continue; }
		fs.mkdirSync(path.dirname(p), { recursive: true });
		fs.writeFileSync(p, content);
	}
	return dir;
}

// Every temp folder this process made, removed by one exit listener.
const tmpDirs = new Set();
process.on('exit', () => {
	if (process.env.DT_KEEP_FIXTURES) return;
	for (const d of tmpDirs) fs.rmSync(d, { recursive: true, force: true });
});

/** A temp folder outside any repo, removed at exit. */
export function tmpDir(prefix = 'dt-files-') {
	const d = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), prefix));
	tmpDirs.add(d);
	return d;
}

export const TREE = {
	'docs/readme.md': '# Readme\n\nHello from the fixture.\n',
	'docs/notes.txt': 'line one\nline two\n',
	'docs/big.txt': 'x'.repeat(40 * 1024),
	'docs/scan.log': 'a sidecar nobody indexes\n',
	'docs/.DS_Store': 'junk',
	'docs/a/x.txt': 'inner\n',
	'docs/a-b.txt': 'sibling\n',
	'media/clip.m4a': Buffer.from([0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70, 0x4d, 0x34, 0x41, 0x20, 1, 2, 3]),
	'docs/trash/old.pdf': '%PDF-1.4 gone',
	'private/secret.txt': 'must not be indexed when include lists docs and media\n',
	'empty/': null,
};

/**
 * A compiled workspace with this module, `DRIVE` and `INBOXES` declared, `.env` pointing `DRIVE` at a
 * fresh copy of TREE and `INBOXES` at two more folders, and one `file-drives` record `drive`
 * (include docs · media · empty, exclude trash · *.log) unless `drives: false`.
 */
export function driveWorkspace({ drives = true, include = ['docs', 'media', 'empty'], exclude = ['trash', '*.log'], tree = TREE } = {}) {
	const ws = workspace({ pkg: { vars: ['DRIVE', 'INBOXES'] } });
	const drive = makeTree(tmpDir('dt-files-drive-'), tree);
	const inboxA = makeTree(tmpDir('dt-files-inbox-a-'), { 'meeting-recordings/one.m4a': Buffer.from([1, 2, 3]), 'health/x.pdf': 'not indexed' });
	const inboxB = makeTree(tmpDir('dt-files-inbox-b-'), { 'meeting-recordings/two.m4a': Buffer.from([4, 5, 6]) });
	fs.writeFileSync(path.join(ws.root, '.env'), `DRIVE=${drive}\nINBOXES="\n${inboxA}\n${inboxB}\n"\n`);
	if (drives) {
		const r = ws.dt('add', 'file-drives', 'Drive', '--path', '${env:DRIVE}', ...include.flatMap((i) => ['--include', i]), ...exclude.flatMap((e) => ['--exclude', e]));
		if (r.code !== 0) throw new Error(r.stderr);
	}
	return { ws, drive, inboxA, inboxB };
}

/** mtime per record file under data/files, for "nothing was written" assertions. */
export function recordMtimes(root) {
	const out = new Map();
	const walk = (d) => {
		if (!fs.existsSync(d)) return;
		for (const e of fs.readdirSync(d, { withFileTypes: true })) {
			const p = path.join(d, e.name);
			if (e.isDirectory()) walk(p); else out.set(path.relative(root, p), fs.statSync(p).mtimeMs);
		}
	};
	walk(path.join(root, 'data', 'files'));
	return out;
}
