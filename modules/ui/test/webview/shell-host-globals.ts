/**
 * The window a shell-flag test runs under — kept apart from shell-host.ts because the flag has to be on `window` before
 * any module of the app is evaluated (`lib/app-shell.ts` reads it once, at import), and shell-host.ts imports the app.
 */
type Listener = (e: unknown) => void;
export const windowListeners: Record<string, Listener[]> = {};

/** Window and document shims that keep their listeners; `host` is the flag (undefined: VS Code, which sets none). */
export function installHost(host: Record<string, unknown> | undefined): void {
	const g = globalThis as Record<string, unknown>;
	g['window'] = {
		...(host ? { __DT_HOST__: host } : {}),
		innerWidth: 1200,
		innerHeight: 900,
		// the search and the toasts animate in: no durations, so every transition ends at once
		getComputedStyle: () => ({}),
		addEventListener(type: string, fn: Listener) { (windowListeners[type] ??= []).push(fn); },
		removeEventListener(type: string, fn: Listener) { windowListeners[type] = (windowListeners[type] ?? []).filter((f) => f !== fn); },
	};
	// createElement: vue's DOM runtime asks for a <template> when it loads, which is after this runs
	g['requestAnimationFrame'] ??= (cb: () => void) => setImmediate(cb);
	// vue-router reads `history.state` when a document exists at its load, as it does here
	g['history'] = { state: null };
	g['document'] = { addEventListener() {}, removeEventListener() {}, createElement: () => ({}), querySelector: () => null };
}

