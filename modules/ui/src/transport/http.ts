/**
 * THE HTTP TRANSPORT — the UI served by a web host (dt web) on the same origin as its `/api`.
 *
 * Requests go to `/api/*` with the session cookie. Server-sent events on `/api/events` and the address
 * bar's hash come back as window `message` events, the same as a webview's host sends them: the hash IS
 * the route (`dt:mounted` → `dt:navigate` from the hash; `dt:route` → the hash), and a file opens from the
 * files origin the host names in `__DT_FILES__`.
 *
 * It keeps the browser's OWN fetch, taken when the transport is made: `mount` teaches `fetch('/api/…')`
 * to go through the transport (for module bundles), so a transport calling the patched fetch would call
 * itself until the stack overflows.
 */
import { HostError, type Transport } from './types';

declare global {
	interface Window {
		/** The files origin's base URL for this server (dt web sets it). */
		__DT_FILES__?: string;
	}
}

export function httpTransport(): Transport {
	const nativeFetch = window.fetch.bind(window);
	const post = (data: unknown) => window.dispatchEvent(new MessageEvent('message', { data }));
	const route = () => location.hash.slice(1) || '/';
	window.addEventListener('hashchange', () => post({ type: 'dt:navigate', route: route() }));
	if (typeof EventSource !== 'undefined') {
		const events = new EventSource('/api/events');
		events.onmessage = (e) => {
			try {
				post(JSON.parse(e.data));
			} catch {
				/* a keep-alive or a malformed event — nothing to deliver */
			}
		};
	}
	let state: unknown = null;
	return {
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
			const error = data && typeof data === 'object' && 'error' in data ? String((data as { error: unknown }).error) : String(res.status);
			throw new HostError(error, res.status);
		},
		notify(type, payload) {
			const m = (payload ?? {}) as { route?: string; path?: string };
			if (type === 'dt:mounted') post({ type: 'dt:navigate', route: route() });
			else if (type === 'dt:route' && typeof m.route === 'string') history.replaceState(null, '', `#${m.route}`);
			else if (type === 'dt:open' && typeof m.route === 'string') window.open(`#${m.route}`, '_blank', 'noopener');
			else if (type === 'dt:open-file' && typeof m.path === 'string' && window.__DT_FILES__) {
				window.open(`${window.__DT_FILES__}/w/${m.path.split('/').map(encodeURIComponent).join('/')}?frame=1`, '_blank', 'noopener');
			}
		},
		setState(s) {
			state = s;
			void state;
		},
	};
}
