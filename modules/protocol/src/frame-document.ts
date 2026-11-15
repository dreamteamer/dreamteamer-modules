// The one self-contained frame document (cr-modules-008 §3, D15; adopted by cr-modules-007 D20 for its VS Code
// artifact frames). Nothing in it is fetched: a module's bundle travels as a JSON data block the guest imports as
// a blob; an artifact's page travels as bodyHtml and its scripts inline. The caller hashes `scriptTexts` when its
// own page policy must admit them (VS Code); this package holds no crypto and no artifact or guest text.

export const FRAME_POLICY = "default-src 'none'; script-src 'unsafe-inline' blob:; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; connect-src 'none'; frame-src 'none'; form-action 'none'; base-uri 'none'; object-src 'none'; worker-src 'none'";

const attr = (s) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
function inline(text) {
	if (/<\/script/i.test(text)) throw new Error('a script text closes its own block (</script) — escape it in the source');
	return text;
}

/**
 * @param {{ guestText: string, bundleText?: string, styleText?: string, meta?: boolean, policy?: string,
 *   bodyHtml?: string, scripts?: Array<{ text: string, type?: 'classic' | 'module' }> }} input
 * @returns {{ html: string, scriptTexts: string[] }} the document, and every executable inline script's exact text in order
 */
export function buildFrameDocument({ guestText, bundleText, styleText = '', meta = false, policy = FRAME_POLICY, bodyHtml = '', scripts = [] }) {
	const scriptTexts = [inline(guestText)];
	const tail = scripts.map(({ text, type = 'classic' }) => {
		if (type !== 'classic' && type !== 'module') throw new Error(`a script is classic or module, not ${type}`);
		scriptTexts.push(inline(text));
		return type === 'module' ? `<script type="module">${text}</script>` : `<script>${text}</script>`;
	}).join('');
	const data = bundleText === undefined ? '' : `<script type="application/json" id="dt-bundle">${JSON.stringify(bundleText).replace(/</g, '\\u003c')}</script>`;
	const html = '<!doctype html><html><head>'
		+ (meta ? `<meta http-equiv="Content-Security-Policy" content="${attr(policy)}">` : '')
		+ '<meta charset="utf-8">'
		+ (styleText ? `<style>${styleText.replace(/<\/style/gi, '<\\/style')}</style>` : '')
		+ data + `<script>${guestText}</script>`
		+ `</head><body>${bodyHtml}${tail}</body></html>`;
	return { html, scriptTexts };
}
