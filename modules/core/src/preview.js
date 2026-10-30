// A read-only markdown rendering of a text-like file, cut at a cap. No external tools: a PDF or a
// Word document has no preview here.
import fs from 'node:fs';

export const PREVIEW_CAP = 32 * 1024;
/** A file larger than this is not read at all, so a large log costs one stat rather than every byte. */
export const PREVIEW_MAX_BYTES = 8 * 1024 * 1024;
export const TEXT_EXTS = new Set(['md', 'markdown', 'txt', 'csv', 'tsv', 'json', 'yaml', 'yml', 'html', 'htm', 'eml', 'log']);
const LANG = { yml: 'yaml', eml: 'text', log: 'text', txt: 'text', htm: 'html' };

export const previewable = (ext) => TEXT_EXTS.has(ext);

/** The preview markdown for `text` of a file with extension `ext`, cut at `cap` characters. */
export function renderPreview(text, ext, cap = PREVIEW_CAP) {
	const cut = text.length > cap;
	const body = (cut ? text.slice(0, cap) : text).trimEnd();
	const note = cut ? `\n\n_(preview cut at ${Math.round(cap / 1024)} KB of ${text.length} characters)_` : '';
	if (ext === 'md' || ext === 'markdown') return body + note;
	// The fence is longer than any run of backticks in the body, so the body cannot close it.
	const longest = (body.match(/`+/g) ?? []).reduce((max, run) => Math.max(max, run.length), 0);
	const fence = '`'.repeat(Math.max(4, longest + 1));
	return `${fence}${LANG[ext] ?? ext}\n${body}\n${fence}${note}`;
}

/** The preview of the file at `abs`, or null when it is not text-like, larger than `maxBytes`, unreadable, or holds binary bytes. */
export function previewOf(abs, ext, { cap = PREVIEW_CAP, maxBytes = PREVIEW_MAX_BYTES } = {}) {
	if (!previewable(ext)) return null;
	let text;
	try {
		if (fs.statSync(abs).size > maxBytes) return null;
		text = fs.readFileSync(abs, 'utf8');
	} catch { return null; }
	if (text.includes('\u0000')) return null;
	return renderPreview(text, ext, cap);
}
