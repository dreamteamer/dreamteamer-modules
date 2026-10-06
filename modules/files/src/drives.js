// Where a drive is, and what of it is indexed. Pure: the engine's env context and renderer are
// passed in, so these rules are tested without a workspace.

const ENV_TOKEN = /\$\{env:([A-Za-z0-9_]+)\}/g;

/** The `${env:NAME}` keys a template names, in order. */
export function envKeysOf(template) {
	return [...String(template ?? '').matchAll(ENV_TOKEN)].map((m) => m[1]);
}

/**
 * The drive's folder on this machine — `{ path }` — or `{ skipped: why }`. `ctx` is the engine's
 * `envContext(ws)`, `render` its `renderTemplate`. With `index`, the FIRST `${env:…}` variable the
 * template names is a newline-separated list and line `index` of it renders; the rest of the
 * template is untouched. Without `index`, a variable of several lines skips the drive.
 */
export function resolveDrivePath(drive, ctx, render) {
	const template = String(drive.path ?? '').trim();
	if (!template) return { skipped: 'no path' };
	const [key] = envKeysOf(template);
	let context = ctx;
	if (drive.index !== undefined && drive.index !== null && drive.index !== '') {
		if (!key) return { skipped: 'index is set but the path names no ${env:…} variable' };
		const index = Number(drive.index);
		if (!Number.isInteger(index) || index < 0) return { skipped: `index must be a whole number from 0 (got "${drive.index}")` };
		const lines = String(ctx.env.get(key) ?? '').split('\n').map((s) => s.trim()).filter(Boolean);
		// Undeclared or empty: the context stays as it is, and the renderer's own error is the reason.
		if (ctx.declared.includes(key) && lines.length) {
			if (index >= lines.length) return { skipped: `\${env:${key}} has ${lines.length} line(s); index ${index} is out of range` };
			const env = new Map(ctx.env);
			env.set(key, lines[index]);
			context = { ...ctx, env };
		}
	}
	let path;
	try { path = render(template, context); } catch (e) { return { skipped: e.message }; }
	if (path.includes('\n')) return { skipped: `\${env:${key}} has several lines — set index on this drive to pick one` };
	return { path };
}

const trimSlashes = (s) => String(s).replace(/^\/+|\/+$/g, '');

/** Is `relpath` under one of the included top-level folders? An empty list includes everything. */
export function included(include, relpath) {
	const list = (include ?? []).map(trimSlashes).filter(Boolean);
	if (!list.length) return true;
	return list.some((top) => relpath === top || relpath.startsWith(`${top}/`));
}

/** Is `relpath` skipped — a dotfile or inside a dot-folder, under an excluded prefix, or carrying an excluded extension? */
export function excluded(exclude, relpath) {
	const segments = relpath.split('/');
	if (segments.some((s) => s.startsWith('.'))) return true;
	const name = segments.at(-1);
	for (const raw of exclude ?? []) {
		const rule = trimSlashes(raw);
		if (!rule) continue;
		if (rule.startsWith('*.')) {
			if (name.toLowerCase().endsWith(rule.slice(1).toLowerCase())) return true;
			continue;
		}
		if (relpath === rule || relpath.startsWith(`${rule}/`)) return true;
	}
	return false;
}

/** `<drive>` or `<drive>/<subfolder>` → `{ drive, subfolder }`, null for nothing. */
export function parseScope(arg) {
	const s = trimSlashes(arg ?? '');
	if (!s) return null;
	const i = s.indexOf('/');
	return i < 0 ? { drive: s, subfolder: null } : { drive: s.slice(0, i), subfolder: s.slice(i + 1) };
}
