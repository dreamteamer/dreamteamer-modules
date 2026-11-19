/**
 * File-codec records in the app: which reference points at one, and where its bytes live.
 *
 * A `codec: file` collection (engine 0.14.0) holds records whose bytes ARE the file. The webview
 * cannot read the disk, so `panel.ts` injects one entry per such collection —
 * `{ collection, path, uri }` — into `window.__DT_FILE_BASES__`, where `uri` is that data root
 * minted as a webview URI (the app cannot derive one: it carries the webview's origin token).
 *
 * ⚠ Everything here keys off the injected LIST, never off a collection name. The dogfood vault's is called
 * `assets`; nothing in this repo may know that (decision 268).
 */
import { hostInfo } from './host-boot';

export interface FileBase {
	collection: string;
	path: string;
	/** `<id>.<suffix>.<ext>` — the middle segment of every record filename in that collection. */
	suffix: string;
	uri?: string;
}

declare global {
	interface Window {
		__DT_FILE_BASES__?: FileBase[];
	}
}

/** GET /host's list (dt web, cr-modules-017), else the injected one (the editor), else empty when the workspace
 *  declares no file-codec collection. */
export function fileBases(): FileBase[] {
	const fromHost = hostInfo.value?.fileBases as FileBase[] | undefined;
	if (Array.isArray(fromHost)) return fromHost;
	return (typeof window !== 'undefined' && window.__DT_FILE_BASES__) || [];
}

/** What an `<img>` can draw. Anything else renders as a link with its extension as a badge. */
const IMAGE_EXTS = new Set(['svg', 'png', 'jpg', 'jpeg', 'webp', 'gif']);
export const isImageExt = (ext?: string | null): boolean => !!ext && IMAGE_EXTS.has(ext.toLowerCase());

/**
 * Split a reference into `{collection, id}` if — and only if — it targets a file-codec collection.
 *
 * ⚠ Never split at the first slash. A collection name can contain one (`family/health/documents`)
 * and so can an id (`2026/mri`), so the boundary is only knowable from the declared list. The list
 * arrives longest-path-first from the host; matching over it in order makes the longest name win.
 */
export function fileRecordRef(value: unknown, bases: FileBase[] = fileBases()): { collection: string; id: string } | null {
	if (typeof value !== 'string' || !value) return null;
	const norm = value.replace(/^\/+/, '');
	// Longest collection NAME first — the injected order sorts by path, which is not the same thing
	// when a workspace authors an explicit storage.path.
	for (const base of [...bases].sort((a, b) => b.collection.length - a.collection.length)) {
		if (norm.startsWith(base.collection + '/')) {
			const id = norm.slice(base.collection.length + 1);
			if (id) return { collection: base.collection, id };
		}
	}
	return null;
}

/**
 * Where a file record's bytes are, as a URI the webview can load — or null when the collection is
 * not one of ours or the host gave it no URI.
 *
 * ⚠ Built from the id, the collection's `suffix` and the record's own derived `ext` — NOT from the
 * item response's `$path`, which is the synthetic `collection/id` the adapter stamps on every
 * record rather than a location on disk (that cost a debugging round: the src silently resolved to
 * null and every logo stayed a text label).
 *
 * Each segment is percent-encoded: a space or a `#` in a filename otherwise truncates the URL.
 */
export function srcForRecord(collection: string, id: string, ext: unknown, bases: FileBase[] = fileBases()): string | null {
	if (typeof ext !== 'string' || !ext) return null;
	const base = bases.find((b) => b.collection === collection);
	if (!base?.uri || !base.suffix) return null;
	const file = id.split('/').map(encodeURIComponent).join('/');
	return `${base.uri}/${file}.${encodeURIComponent(base.suffix)}.${encodeURIComponent(ext)}`;
}
