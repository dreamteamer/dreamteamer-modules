// A read-only markdown rendering of a text-like file, cut at a cap. No external tools: a PDF or a
// Word document has no preview here.
import fs from 'node:fs';

export const PREVIEW_CAP = 32 * 1024;
export const TEXT_EXTS = new Set(['md', 'markdown', 'txt', 'csv', 'tsv', 'json', 'yaml', 'yml', 'html', 'htm', 'eml', 'log']);
const LANG = { yml: 'yaml', eml: 'text', log: 'text', txt: 'text', htm: 'html', markdown: 'md' };

export const previewable = (ext) => TEXT_EXTS.has(ext);

/** The preview markdown for `text` of a file with extension `ext`, cut at `cap` characters. */
export function renderPreview(text, ext, cap = PREVIEW_CAP) {
	const cut = text.length > cap;
	const body = (cut ? text.slice(0, cap) : text).replace(/\s+$/, '');
	const note = cut ? `\n\n_(preview cut at ${Math.round(cap / 1024)} KB of ${text.length} characters)_` : '';
	if (ext === 'md' || ext === 'markdown') return body + note;
	return `\`\`\`\`${LANG[ext] ?? ext}\n${body}\n\`\`\`\`${note}`;
}

/** The preview of the file at `abs`, or null when it is not text-like, unreadable, or holds binary bytes. */
export function previewOf(abs, ext, { cap = PREVIEW_CAP } = {}) {
	if (!previewable(ext)) return null;
	let text;
	try { text = fs.readFileSync(abs, 'utf8'); } catch { return null; }
	if (text.includes('\u0000')) return null;
	return renderPreview(text, ext, cap);
}
