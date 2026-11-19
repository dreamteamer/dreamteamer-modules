/**
 * The app's one door to its host. Everything the app used to `fetch('/api/…')` goes through the
 * transport the host handed `mount` (transport/types.ts): a `postMessage` channel to the VS Code
 * extension, which answers in-process, or HTTP to dt web. Same clean REST contract, same shapes, same
 * error semantics on every host.
 */
import { HostError, type Transport } from '../transport/types';

export { HostError };

declare global {
	interface Window {
		/** URI of `.dreamteamer/ui/` — module app bundles are imported from here. */
		__DT_UI_BASE__?: string;
	}
}

let transport: Transport | null = null;

/** Set once, by `mount`, before anything asks the host. */
export function setTransport(t: Transport): void {
	transport = t;
}

function current(): Transport {
	if (!transport) throw new Error('no transport — the app was not mounted by a host');
	return transport;
}

/**
 * One clean-contract request. `path` is everything after `/api` (e.g. `/collections/tasks/records?limit=25`).
 */
export function hostRequest(method: string, path: string, body?: unknown): Promise<unknown> {
	return current().request(method, path, body);
}

/**
 * MODULE COMPATIBILITY SHIM.
 *
 * A workspace module's `app.js` (spec §8) is a pre-built bundle we do not control and cannot
 * rebuild — a workspace's own kanban calls `fetch('/api/collections/…')` straight out of the documented
 * HTTP contract. With the server gone that request resolves against `vscode-webview://` and dies
 * with a 403, so this teaches `fetch` to answer `/api/*` from the host instead.
 *
 * Deliberately a shim rather than a contract change: "a module talks to /api" stays true on every
 * surface, so the same bundle keeps working whether it's loaded here or by a future HTTP host.
 * Must be installed BEFORE the first module entry is imported.
 */
export function installApiFetchShim(): void {
	const original = window.fetch.bind(window);
	window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
		const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
		if (!url.startsWith("/api/") && url !== "/api") return original(input as any, init);

		const method = init?.method ?? (typeof input === "object" && "method" in input ? input.method : "GET");
		let body: unknown;
		if (init?.body) {
			try {
				body = JSON.parse(String(init.body));
			} catch {
				body = init.body;
			}
		}
		try {
			const data = await hostRequest(String(method).toUpperCase(), url.slice(4), body);
			return jsonResponse(200, data);
		} catch (err) {
			const status = err instanceof HostError ? err.status : 500;
			return jsonResponse(status, { error: err instanceof Error ? err.message : String(err) });
		}
	};
}

function jsonResponse(status: number, data: unknown): Response {
	const text = JSON.stringify(data ?? null);
	// a real Response so `res.ok`, `res.status`, `res.json()` and `res.text()` all behave
	return new Response(text, {
		status,
		statusText: status < 400 ? "OK" : "Error",
		headers: { "content-type": "application/json" },
	});
}

/** Fire-and-forget notifications to the host (open a file in an editor, reveal a tree node, …). */
export function hostNotify(type: string, payload?: unknown): void {
	try {
		current().notify(type, payload);
	} catch {
		/* outside a webview (unit/dev) — notifications are best-effort */
	}
}

/**
 * Persist this tab's identity (route + whether it's pinned) into VS Code's own webview state.
 * It is the ONLY thing that survives a window reload: the panel serializer hands it straight back
 * to the extension, which is how N open tabs come back on N different routes instead of all
 * snapping to the last one visited (explorer tabs, operator 2026-07-27).
 */
export function hostSetState(state: unknown): void {
	try {
		current().setState?.(state);
	} catch {
		/* outside a webview (unit/dev) — nothing to persist */
	}
}
