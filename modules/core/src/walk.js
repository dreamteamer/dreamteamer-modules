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

/** A name no record id can carry: a control character (macOS writes `Icon\r` into a folder with a
 *  custom icon), DEL, or a backslash. */
export const UNSAFE_NAME = /[\u0000-\u001f\u007f\\]/;

/**
 * Every file and folder under `root`, sorted by path. `include` limits the top level (empty = all),
 * `exclude` prunes anywhere, `subfolder` walks one subtree and lists that folder first. Paths and
 * names are Unicode NFC, the form git commits a filename in; `abs` keeps the name as it is on disk.
 * The returned array also carries two non-enumerable lists: `unsafe`, the paths skipped because a
 * name holds a character an id cannot, and `unreadable`, the folders whose listing failed — what is
 * under them is unknown, not gone.
 */
export function walkDrive(root, { include = [], exclude = [], subfolder = null } = {}) {
	const out = [];
	const unsafe = [], unreadable = [];
	Object.defineProperty(out, 'unsafe', { value: unsafe });
	Object.defineProperty(out, 'unreadable', { value: unreadable });
	const entryOf = (relpath, name, st, abs) => {
		if (st.isDirectory()) return { path: relpath, name, kind: 'folder', abs };
		const ext = extOf(name);
		return { path: relpath, name, kind: 'file', ext, mime: mimeOf(ext), bytes: st.size, modified: isoLocal(st.mtime), local: isLocal(st), abs };
	};
	// `rel` is the NFC path the records use, `raw` the same folder as the disk spells it.
	const visit = (rel, raw) => {
		let names;
		try { names = fs.readdirSync(path.join(root, raw)).sort(); } catch { unreadable.push(rel); return; }
		for (const rawName of names) {
			const name = rawName.normalize('NFC');
			const relpath = rel ? `${rel}/${name}` : name;
			if (excluded(exclude, relpath)) continue;
			if (!rel && !included(include, relpath)) continue;
			if (UNSAFE_NAME.test(name)) { unsafe.push(relpath); continue; }
			const abs = path.join(root, raw, rawName);
			// lstat, so a link is neither a file nor a folder and is skipped: a sync client does not sync
			// links, and a link can point anywhere, past the include list.
			let st;
			try { st = fs.lstatSync(abs); } catch { continue; }
			if (!st.isDirectory() && !st.isFile()) continue;
			out.push(entryOf(relpath, name, st, abs));
			if (st.isDirectory()) visit(relpath, raw ? `${raw}/${rawName}` : rawName);
		}
	};
	const rel = subfolder ? String(subfolder).normalize('NFC').replace(/\/+/g, '/').replace(/^\/|\/$/g, '') : '';
	if (rel) {
		if (!included(include, rel) || excluded(exclude, rel)) return out;
		// Every segment must be a real folder, not a link, for the same reason the walk skips links.
		// A segment that is not there means the scope is gone, and what was under it is missing. Any
		// other failure (no permission, an I/O error, a timeout on a cloud mount) means it cannot be
		// reached: the folder above the segment is reported unreadable — the one whose search failed,
		// as a full walk would report it — so the scope and everything in it are left as they were.
		let st;
		const segments = rel.split('/');
		for (let i = 1; i <= segments.length; i++) {
			try { st = fs.lstatSync(path.join(root, ...segments.slice(0, i))); } catch (e) {
				if (e.code !== 'ENOENT' && e.code !== 'ENOTDIR') unreadable.push(segments.slice(0, i - 1).join('/'));
				return out;
			}
			if (!st.isDirectory()) return out;
		}
		out.push(entryOf(rel, segments.at(-1), st, path.join(root, rel)));
		visit(rel, rel);
	} else {
		visit('', '');
	}
	return out.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}
