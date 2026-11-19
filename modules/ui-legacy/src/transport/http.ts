/**
 * THE HTTP TRANSPORT — the UI served by a web host (dt web) on the same origin as its `/api`.
 *
 * Requests go to `/api/*` with the session cookie. Server-sent events on `/api/events` and the address
 * bar's hash come back as window `message` events, the same as a webview's host sends them: the hash IS
 * the route (`dt:mounted` → `dt:navigate` from the hash; `dt:route` → the hash), and a file opens from the
 * files base `GET /host` answered (cr-modules-017; `__DT_FILES__` on an older shell).
 *
 * The files key rotates every time the server starts, so every event-stream open after the first asks
 * `GET /host` again BEFORE it posts the invalidation that redraws. A 401 from any request means the session
 * is gone: `signedOut` is set and the app draws the signed-out sentence over the page.
 *
 * The page does not wait for a click to learn that (the h8 amendment): sessions live in the server's memory, so a
 * restarted server answers the event stream 401 and the browser gives the stream up for good, firing nothing more.
 * When the stream drops, the transport asks `GET /host` itself — a 401 signs the page out at once; no answer, a few
 * times over, means the server and every session with it are gone, which signs it out too; an answer means the
 * session holds, and a stream the browser gave up is opened again.
 *
 * It keeps the browser's OWN fetch, taken when the transport is made: `mount` teaches `fetch('/api/…')`
 * to go through the transport (for module bundles), so a transport calling the patched fetch would call
 * itself until the stack overflows.
 */
import { HostError, type Transport } from './types';
import { filesBase, loadHost, signedOut } from '../lib/host-boot';

declare global {
	interface Window {
		/** The files origin's base URL for this server (dt web sets it). */
		__DT_FILES__?: string;
	}
}

/** EventSource's readyState values (the constants are not on every stand-in). */
const STREAM_OPEN = 1;
const STREAM_CLOSED = 2;
/** How many times GET /host gets no answer at all before the page reads the server as gone. */
const NO_ANSWER_TRIES = 3;

export interface HttpTransportOptions {
	/** The first wait between re-checks after the event stream drops; each next one doubles. Tests shorten it. */
	recheckMs?: number;
}

export function httpTransport({ recheckMs = 1000 }: HttpTransportOptions = {}): Transport {
	const nativeFetch = window.fetch.bind(window);
	const post = (data: unknown) => window.dispatchEvent(new MessageEvent('message', { data }));
	const route = () => location.hash.slice(1) || '/';
	const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
	window.addEventListener('hashchange', () => post({ type: 'dt:navigate', route: route() }));
	let events: EventSource | null = null;
	// EventSource reconnects by itself, but a change made while it was down is never sent again: on every
	// open after the first, refetch everything (schema and records) as an invalidation would
	let opened = false;
	let checking = false;
	const openEvents = () => {
		const source = new EventSource('/api/events');
		events = source;
		// In a browser the page is the only view of the workspace, so an invalidation re-fetches the open page
		// too (`pages`): a `dt set` in a terminal, an agent's write or a `git pull` redraws the list or record
		// without a reload. Under VS Code the same flag comes only from the refresh button — the editor's
		// native tree already shows the change, and the watcher there would be a request storm; here the
		// server debounces its events, so one burst is one re-fetch.
		source.onopen = async () => {
			const again = opened;
			opened = true;
			if (!again) return;
			await loadHost((method, path, body) => transport.request(method, path, body));
			post({ type: 'dt:invalidate', scope: 'schema', pages: true });
		};
		source.onmessage = (e) => {
			try {
				const m = JSON.parse(e.data) as { type?: string; pages?: boolean };
				post(m?.type === 'dt:invalidate' ? { ...m, pages: true } : m);
			} catch {
				/* a keep-alive or a malformed event — nothing to deliver */
			}
		};
		source.onerror = () => recheck();
	};
	/** The stream dropped: is this page still signed in? One re-check at a time, however many errors fire. */
	const recheck = async (): Promise<void> => {
		if (checking || signedOut.value) return;
		checking = true;
		try {
			for (let tries = 0, wait = recheckMs; ; tries++, wait *= 2) {
				if (events?.readyState === STREAM_OPEN) return; // back on its own: its open refetches
				try {
					await transport.request('GET', '/host');
				} catch (err) {
					if (signedOut.value) return; // a 401: request() set it
					if (err instanceof HostError && err.status === 0) {
						// no answer at all: nothing listens, so the server — and the page's session, in its memory — is gone
						if (tries + 1 >= NO_ANSWER_TRIES) { signedOut.value = true; return; }
						await sleep(wait);
						continue;
					}
					// the server answered something else: it is there, and so is the session
				}
				if (events?.readyState === STREAM_CLOSED) openEvents(); // the browser gave the stream up: open it again
				return;
			}
		} finally {
			checking = false;
			if (signedOut.value) events?.close(); // nothing left to reconnect to
		}
	};
	if (typeof EventSource !== 'undefined') openEvents();
	let state: unknown = null;
	const transport: Transport = {
		async request(method, path, body) {
			const init: RequestInit = { method, credentials: 'same-origin', headers: {} };
			if (body !== undefined) {
				init.body = JSON.stringify(body);
				(init.headers as Record<string, string>)['content-type'] = 'application/json';
			}
			let res: Response;
			try {
				res = await nativeFetch(`/api${path}`, init);
			} catch (err) {
				throw new HostError(String(err), 0);
			}
			const text = await res.text();
			let data: unknown = null;
			try {
				data = text ? JSON.parse(text) : null;
			} catch {
				data = text;
			}
			if (res.ok) return data;
			if (res.status === 401) signedOut.value = true;
			const error = data && typeof data === 'object' && 'error' in data ? String((data as { error: unknown }).error) : String(res.status);
			throw new HostError(error, res.status);
		},
		notify(type, payload) {
			const m = (payload ?? {}) as { route?: string; path?: string };
			if (type === 'dt:mounted') post({ type: 'dt:navigate', route: route() });
			else if (type === 'dt:route' && typeof m.route === 'string') history.replaceState(null, '', `#${m.route}`);
			else if (type === 'dt:open' && typeof m.route === 'string') window.open(`#${m.route}`, '_blank', 'noopener');
			else if (type === 'dt:open-file' && typeof m.path === 'string' && filesBase()) {
				window.open(`${filesBase()}/w/${m.path.split('/').map(encodeURIComponent).join('/')}?frame=1`, '_blank', 'noopener');
			}
		},
		setState(s) {
			state = s;
			void state;
		},
	};
	return transport;
}
