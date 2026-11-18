/**
 * One cached fetch of the clean `GET /api/info` — the boot data both module-app loading
 * (modules.ts reads `ui`) and ui-view route registration (ui-views.ts reads `user` for `@me`
 * resolution) need before mount. Deliberately straight through the transport, not the adapter:
 * this is the clean contract, and the adapter is transitional debt slated for deletion.
 */
import { hostRequest } from './transport';

export interface ServerInfo {
	name: string;
	host?: string;
	compiled?: string;
	/** Module UI bundle short-names staged by compile — each imports from `/ui/<name>/app.js`. */
	ui: string[];
	/** The operator's users-record id — `@me` in a ui-view filter resolves to `users/<user>`. */
	user: string;
}

let infoPromise: Promise<ServerInfo> | null = null;

/** Drop the cached `/info` — a compile can add a module UI bundle or move `compiled`. */
export function invalidateServerInfo(): void {
	infoPromise = null;
}

export function loadServerInfo(): Promise<ServerInfo> {
	if (!infoPromise) {
		infoPromise = hostRequest('GET', '/info')
			.then((raw) => {
				const json = (raw ?? {}) as Partial<ServerInfo>;
				return {
					name: typeof json.name === 'string' ? json.name : 'dt',
					host: json.host,
					compiled: json.compiled,
					ui: Array.isArray(json.ui) ? json.ui.filter((n): n is string => typeof n === 'string') : [],
					user: typeof json.user === 'string' ? json.user : '',
				};
			})
			.catch((err: unknown) => {
				infoPromise = null; // a failed boot fetch must not wedge the cache forever
				throw err;
			});
	}
	return infoPromise;
}
