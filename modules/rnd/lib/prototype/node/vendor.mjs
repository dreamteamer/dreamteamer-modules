// `npx dt-prototype vendor [--force]` and `init`. The browser half is COPIED into the prototype's
// `<public>/harness/` (a static, no-build prototype cannot import from node_modules), each file stamped on its
// first line with the package version and a sha256 of the body below the stamp, line endings normalised to LF.
// A body that no longer matches its stamp is a local edit — a fork — and is refused unless --force; a stamp
// whose version is not the running package's is stale, which `check` and `play` report.
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { loadConfig, CONFIG_FILE } from './config.mjs';
import { VERSION } from './export.mjs';

export const SOURCE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'browser');
const STAMP = /^(?:\/\/|\/\*) @dreamteamer\/rnd (\S+) prototype-harness — vendored, do not edit — sha256:([0-9a-f]{64})(?: \*\/)?\r?$/;

export const hashBody = (body) => createHash('sha256').update(body.replace(/\r\n/g, '\n')).digest('hex');
export function stampLine(file, version, hash) {
	const text = `@dreamteamer/rnd ${version} prototype-harness — vendored, do not edit — sha256:${hash}`;
	return file.endsWith('.css') ? `/* ${text} */` : `// ${text}`;
}
/** { version, hash, body } of a vendored file's text, or null when line 1 is not a stamp */
export function parseStamp(text) {
	const nl = text.indexOf('\n');
	const first = nl < 0 ? text : text.slice(0, nl);
	const m = STAMP.exec(first);
	return m ? { version: m[1], hash: m[2], body: nl < 0 ? '' : text.slice(nl + 1) } : null;
}
/** the text `vendor` writes for one package file */
export function vendored(file, source, version = VERSION) {
	return `${stampLine(file, version, hashBody(source))}\n${source}`;
}
export const sourceFiles = () => fs.readdirSync(SOURCE).filter((f) => /\.(js|css)$/.test(f)).sort();

/** the state of every vendored file: ok · stale (another version) · edited (body ≠ hash) · unstamped · missing */
export function vendorStatus(harnessDir, version = VERSION) {
	return sourceFiles().map((file) => {
		const at = path.join(harnessDir, file);
		if (!fs.existsSync(at)) return { file, state: 'missing' };
		const s = parseStamp(fs.readFileSync(at, 'utf8'));
		if (!s) return { file, state: 'unstamped' };
		if (hashBody(s.body) !== s.hash) return { file, state: 'edited', version: s.version };
		return { file, state: s.version === version ? 'ok' : 'stale', version: s.version };
	});
}

/** copy the browser half into `harnessDir` → { written, unchanged, refused } */
export function vendorInto(harnessDir, { force = false, version = VERSION } = {}) {
	const out = { written: [], unchanged: [], refused: [] };
	fs.mkdirSync(harnessDir, { recursive: true });
	for (const file of sourceFiles()) {
		const want = vendored(file, fs.readFileSync(path.join(SOURCE, file), 'utf8'), version);
		const at = path.join(harnessDir, file);
		if (fs.existsSync(at)) {
			const have = fs.readFileSync(at, 'utf8');
			const s = parseStamp(have);
			if (!force && (!s || hashBody(s.body) !== s.hash)) { out.refused.push({ file, why: s ? 'edited since it was vendored' : 'not a vendored file' }); continue; }
			if (have.replace(/\r\n/g, '\n') === want) { out.unchanged.push(file); continue; }
		}
		fs.writeFileSync(at, want);
		out.written.push(file);
	}
	return out;
}

export const SKELETON = `// harness.config.mjs — what the prototype harness needs to know about this prototype (read by npx dt-prototype).
export default {
	products: {
		// 'rnd/products/<id>': { key: '<route prefix>', label: '<shown in the guide>' },
	},
	app: '__app',                                  // the window global the tools drive: window[app] = app
	registry: 'public/app/screens/index.js',       // node-importable: export const screens = [...]
	// data: 'public/app/data', playback: 'public/app/demo/journeys', public: 'public',
	// rules: 'tools/rules.mjs', scrub: 'tools/scrub.mjs', forbidden: 'harness.forbidden.txt',
	// prototype: 'rnd/prototypes/<id>',          // what check --apply stamps on each screen
};
`;

export async function run(dir, { force = false, init = false, log = console.log, error = console.error } = {}) {
	const cfgFile = path.join(path.resolve(dir), CONFIG_FILE);
	let harnessDir;
	if (init) {
		if (fs.existsSync(cfgFile)) log(`${CONFIG_FILE} exists — left alone`);
		else { fs.writeFileSync(cfgFile, SKELETON); log(`wrote ${CONFIG_FILE} — fill in products, app and registry`); }
		harnessDir = path.join(path.resolve(dir), 'public', 'harness');
		try { harnessDir = (await loadConfig(dir)).paths.harness; } catch { /* a skeleton does not load until it is filled in */ }
	} else harnessDir = (await loadConfig(dir)).paths.harness;
	const r = vendorInto(harnessDir, { force });
	const rel = path.relative(path.resolve(dir), harnessDir);
	for (const f of r.written) log(`wrote ${rel}/${f}`);
	for (const f of r.refused) error(`refused ${rel}/${f.file} — ${f.why}; --force replaces it with the package's file`);
	log(`@dreamteamer/rnd ${VERSION} · ${r.written.length} written · ${r.unchanged.length} unchanged · ${r.refused.length} refused`);
	return r.refused.length ? 1 : 0;
}
