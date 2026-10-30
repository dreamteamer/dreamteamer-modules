// The prototype's declaration to the Node tools: `harness.config.mjs` at the prototype's root, loaded once,
// checked, and filled with defaults. Every path in it is relative to the prototype's folder.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { findWorkspace } from '../../workspace-root.mjs';

export const CONFIG_FILE = 'harness.config.mjs';
export const KNOWN = ['products', 'portal', 'screenKey', 'cross', 'group', 'groupOrder', 'app', 'public', 'data', 'playback', 'registry', 'store',
	'rules', 'scrub', 'journeyFields', 'forbidden', 'serve', 'workspace', 'prototype', 'defaultUser', 'viewport', 'locale'];
export const DEFAULTS = {
	portal: { from: 'product' },
	cross: { key: 'x', label: 'Cross-portal' },
	public: 'public',
	data: 'public/app/data',
	playback: 'public/app/demo/journeys',
	journeyFields: [],
	serve: 'python3 -m http.server {port} --bind 127.0.0.1 --directory {public}',
	viewport: { width: 1440, height: 900 },
};

const fail = (msg) => { throw new Error(`${CONFIG_FILE}: ${msg}`); };
const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);

/** Check a raw config and fill its defaults; `dir` is the prototype folder. Pure apart from the workspace walk. */
export function normalize(raw, dir) {
	if (!isObj(raw)) fail('must export default an object');
	for (const k of Object.keys(raw)) if (!KNOWN.includes(k)) fail(`unknown key "${k}"${k === 'collections' ? ' — the harness reads the rnd collection names only' : ''} (known: ${KNOWN.join(', ')})`);
	for (const k of ['products', 'app', 'registry']) if (raw[k] == null) fail(`"${k}" is required`);
	if (!isObj(raw.products) || !Object.keys(raw.products).length) fail('"products" maps rnd/products/<id> to { key, label? }');
	for (const [ref, v] of Object.entries(raw.products)) {
		if (!/^rnd\/products\/[^/]+$/.test(ref)) fail(`products: "${ref}" is not an rnd/products/<id> reference`);
		if (!isObj(v) || typeof v.key !== 'string' || !v.key) fail(`products["${ref}"] needs a string key`);
	}
	for (const k of ['screenKey', 'group']) if (raw[k] != null && typeof raw[k] !== 'function') fail(`"${k}" must be a function`);
	const c = { ...DEFAULTS, ...raw, dir: path.resolve(dir) };
	c.screenKey = raw.screenKey ?? ((k) => k);
	if (!['product', 'field', 'tag'].includes(c.portal?.from)) fail('portal.from is "product", "field" or "tag"');
	if (c.portal.from === 'field' && typeof c.portal.field !== 'string') fail('portal: { from: "field" } needs a field name');
	if (c.portal.from === 'tag' && (typeof c.portal.prefix !== 'string' || !c.portal.prefix)) fail('portal: { from: "tag" } needs a prefix (e.g. "portal:")');
	if (c.portal.map != null && !isObj(c.portal.map)) fail('portal.map maps record values to portal keys');
	if (!isObj(c.cross) || typeof c.cross.key !== 'string') fail('cross needs a key');
	if (!Array.isArray(c.journeyFields)) fail('journeyFields is a list of field names');
	if (c.prototype != null && typeof c.prototype !== 'string') fail('prototype is rnd/prototypes/<id> or an id');
	if (c.prototype && !c.prototype.startsWith('rnd/prototypes/')) c.prototype = `rnd/prototypes/${c.prototype}`;
	const abs = (p) => (p == null ? null : path.resolve(c.dir, p));
	c.paths = { public: abs(c.public), data: abs(c.data), playback: abs(c.playback), registry: abs(c.registry), store: abs(c.store), rules: abs(c.rules), scrub: abs(c.scrub), forbidden: abs(c.forbidden), harness: path.join(abs(c.public), 'harness') };
	c.workspace = c.workspace ? path.resolve(c.dir, c.workspace) : findWorkspace(path.dirname(c.dir)) ?? findWorkspace(c.dir);
	if (!c.workspace) fail('no workspace above the prototype (no package.json beside a package-lock.json); set "workspace"');
	return c;
}

/** Load `<dir>/harness.config.mjs`. */
export async function loadConfig(dir) {
	const file = path.join(path.resolve(dir), CONFIG_FILE);
	if (!fs.existsSync(file)) throw new Error(`no ${CONFIG_FILE} in ${path.resolve(dir)} — run \`npx dt-prototype init\``);
	const mod = await import(`${pathToFileURL(file).href}?t=${fs.statSync(file).mtimeMs}`);
	return normalize(mod.default, dir);
}

/** Where a screen's portal is read under the escape hatch, for messages: `portal` · `portal:… tag`. */
export const portalSource = (c) => (c.portal.from === 'tag' ? `${c.portal.prefix}… tag` : c.portal.field);
/** A screen row's raw portal value under the escape hatch (a field, or the rest of a `<prefix><value>` tag), or null. */
export function portalValue(c, row) {
	if (c.portal.from === 'field') { const v = row[c.portal.field]; return v == null || v === '' ? null : String(v); }
	if (c.portal.from === 'tag') { const t = (row.tags ?? []).find((x) => typeof x === 'string' && x.startsWith(c.portal.prefix)); return t ? t.slice(c.portal.prefix.length) : null; }
	return null;
}

/** The portal key of a product reference, or null when the product is outside the prototype. */
export const productKey = (c, ref) => c.products[ref]?.key ?? null;
