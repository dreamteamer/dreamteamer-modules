/**
 * THE ONE SEAM of the webview render tier: `webview/src/api/transport.ts` stands in as this module
 * (`scripts/test.mjs` resolves it here), so a test answers the HOST and everything above the wire —
 * the adapter's path translation, the record/relation value mapping, the contract cache, the
 * composables, the component — is the REAL code.
 *
 * Deliberately not a mock of `api/client`: the defects this tier exists to catch live in what a
 * component does with a projection the host sent, and a stub above the adapter would invent that
 * projection instead of carrying it.
 */

export class HostError extends Error {
	status: number;
	constructor(message: string, status: number) {
		super(message);
		this.name = 'HostError';
		this.status = status;
	}
}

export type Responder = (method: string, path: string, body?: unknown) => unknown | Promise<unknown>;

/** Every request the run has seen, in order — assert on WHAT a gesture called, not only its result. */
export const requests: Array<{ method: string; path: string; body?: unknown }> = [];

let responder: Responder = () => {
	throw new HostError('no host responder installed — call onHostRequest() first', 500);
};

export function onHostRequest(fn: Responder): void {
	responder = fn;
}

/** Fresh state per test: the adapter caches `/presentation` module-side, so seed before the first read. */
export function resetHost(): void {
	requests.length = 0;
	responder = () => {
		throw new HostError('no host responder installed — call onHostRequest() first', 500);
	};
}

export async function hostRequest(method: string, path: string, body?: unknown): Promise<unknown> {
	requests.push({ method, path, ...(body === undefined ? {} : { body }) });
	return await responder(method, path, body);
}

export const notifications: Array<{ type: string; payload?: unknown }> = [];

export function hostNotify(type: string, payload?: unknown): void {
	notifications.push({ type, payload });
}

export function installApiFetchShim(): void {
	/* no fetch to shim under node --test */
}

export function hostSetState(_state: unknown): void {
	/* the webview-state round trip is the host's, not this tier's */
}
