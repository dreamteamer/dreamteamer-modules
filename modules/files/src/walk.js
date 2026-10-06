// The disk walk: what is under a drive's folder, as entries. Reads names, sizes and dates — never a
// file's bytes, because on a cloud-synced folder reading an evicted file downloads it.
import fs from 'node:fs';
import path from 'node:path';
import { included, excluded } from './drives.js';

export const MIME = {
	pdf: 'application/pdf', md: 'text/markdown', markdown: 'text/markdown', txt: 'text/plain', log: 'text/plain',
	csv: 'text/csv', tsv: 'text/tab-separated-values', json: 'application/json', yaml: 'application/yaml', yml: 'application/yaml',
	html: 'text/html', htm: 'text/html', eml: 'message/rfc822', xml: 'application/xml',
	png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml', tiff: 'image/tiff', heic: 'image/heic',
	m4a: 'audio/mp4', mp3: 'audio/mpeg', wav: 'audio/wav', mp4: 'video/mp4', mov: 'video/quicktime',
	doc: 'application/msword', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
	xls: 'application/vnd.ms-excel', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
	ppt: 'application/vnd.ms-powerpoint', pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
	zip: 'application/zip',
};

/** The extension, lowercase, without the dot; '' for none or for a dotfile's "extension". */
export function extOf(name) {
	const i = name.lastIndexOf('.');
	return i > 0 ? name.slice(i + 1).toLowerCase() : '';
}

export const mimeOf = (ext) => MIME[ext] ?? '';

/** Are the bytes on disk? A sync client that evicts a file leaves a size and zero blocks. */
export const isLocal = (st) => st.blocks === undefined || st.size === 0 || st.blocks > 0;

/** An instant as ISO 8601 with the local offset, to the second — `2026-01-02T05:04:05+02:00`. */
export function isoLocal(date) {
	const d = new Date(date);
	const pad = (n) => String(n).padStart(2, '0');
	const off = -d.getTimezoneOffset();
	const a = Math.abs(off);
	return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}${off < 0 ? '-' : '+'}${pad(Math.floor(a / 60))}:${pad(a % 60)}`;
}

/**
 * Every file and folder under `root`, sorted by path. `include` limits the top level (empty = all),
 * `exclude` prunes anywhere, `subfolder` walks one subtree and lists that folder first.
 */
export function walkDrive(root, { include = [], exclude = [], subfolder = null } = {}) {
	const out = [];
	const entryOf = (relpath, name, st) => {
		const abs = path.join(root, relpath);
		if (st.isDirectory()) return { path: relpath, name, kind: 'folder', abs };
		const ext = extOf(name);
		return { path: relpath, name, kind: 'file', ext, mime: mimeOf(ext), bytes: st.size, modified: isoLocal(st.mtime), local: isLocal(st), abs };
	};
	const visit = (rel) => {
		let names;
		try { names = fs.readdirSync(path.join(root, rel)).sort(); } catch { return; }
		for (const name of names) {
			const relpath = rel ? `${rel}/${name}` : name;
			if (excluded(exclude, relpath)) continue;
			if (!rel && !included(include, relpath)) continue;
			let st;
			try { st = fs.statSync(path.join(root, relpath)); } catch { continue; }
			if (!st.isDirectory() && !st.isFile()) continue;
			out.push(entryOf(relpath, name, st));
			if (st.isDirectory()) visit(relpath);
		}
	};
	if (subfolder) {
		const rel = String(subfolder).replace(/^\/+|\/+$/g, '');
		if (!included(include, rel) || excluded(exclude, rel)) return out;
		let st;
		try { st = fs.statSync(path.join(root, rel)); } catch { return out; }
		if (!st.isDirectory()) return out;
		out.push(entryOf(rel, rel.split('/').pop(), st));
		visit(rel);
	} else {
		visit('');
	}
	return out;
}
