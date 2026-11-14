/**
 * Declared-variable roots in the app: the folders outside the workspace a webview may read, and the
 * webview uri each maps to. Injected by `panel.ts` as `window.__DT_VAR_ROOTS__` (`{ name, path, uri }`
 * per variable that renders to a directory) beside `__DT_FILE_BASES__`, for the same reason: a webview
 * uri carries the webview's origin token and the app cannot mint one.
 *
 * ⚠ Nothing here knows a variable's name. The dogfood vault declares FILES_FOLDER; another workspace
 * declares whatever it declares. Only the injected LIST decides.
 */
import { hostInfo } from './host-boot';

export interface VarRoot {
	name: string;
	path: string;
	uri: string;
}
declare global {
	interface Window {
		__DT_VAR_ROOTS__?: VarRoot[];
	}
}
/** GET /host's roots (dt web, cr-modules-017), else the injected ones (the editor). */
export function varRoots(): VarRoot[] {
	const fromHost = hostInfo.value?.varRoots as VarRoot[] | undefined;
	if (Array.isArray(fromHost)) return fromHost;
	return (typeof window !== 'undefined' && window.__DT_VAR_ROOTS__) || [];
}
/** The webview uri for an absolute path under one of the roots, or null when no root contains it.
 *  Longest root first, so a root nested inside another wins. */
export function uriForPath(absPath: string, roots: VarRoot[] = varRoots()): string | null {
	const norm = absPath.replace(/\/+$/, '');
	for (const r of [...roots].sort((a, b) => b.path.length - a.path.length)) {
		const base = r.path.replace(/\/+$/, '');
		if (norm === base || norm.startsWith(base + '/')) {
			const rel = norm.slice(base.length).split('/').filter(Boolean).map(encodeURIComponent).join('/');
			return rel ? `${r.uri.replace(/\/+$/, '')}/${rel}` : r.uri;
		}
	}
	return null;
}
