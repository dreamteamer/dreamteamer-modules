/**
 * THE PAGE'S BOOT VALUES — cr-modules-017. Under dt web the shell carries only the host's capabilities
 * (`__DT_HOST__`); everything that names a URL or a grant — the files and frames bases, the file-codec bases,
 * the declared var roots, the module grants — and the pane's own values (level, chat, the workspace) come from
 * `GET /host` behind the cookie, read before mount and again after every reconnect (the files key rotates on
 * every start). The editor still injects its globals; every lookup reads `hostInfo` first and falls back to
 * them, so the same app runs on both.
 *
 * `hostInfo` is a ref: an image or a frame drawn from it re-renders when a reconnect brings a new key.
 */
import { ref } from 'vue';
import type { HostInfo } from '@dreamteamer/protocol/pane';
import { hostRequest, HostError } from '../api/transport';

export type { HostInfo };

/** What the host answered on GET /host, or null — the editor before it answers one, or a page not loaded yet. */
export const hostInfo = ref<HostInfo | null>(null);
/** The session is gone (a 401): the page draws the signed-out sentence instead of itself. */
export const signedOut = ref(false);

/** The sentence a signed-out page shows — the chat is where a person gets back in. */
export const SIGNED_OUT = 'This pane is signed out. Ask the chat to show it again — it runs dt web open.';

type Request = (method: string, path: string, body?: unknown) => Promise<unknown>;

/** Ask the host for the page's boot values. 401 → signed out, null; a host without the route (404) or any
 *  other failure → null, and the window globals stay in charge. Never rejects. */
export async function loadHost(request: Request = hostRequest): Promise<HostInfo | null> {
	try {
		const info = (await request('GET', '/host')) as HostInfo | null;
		hostInfo.value = info && typeof info === 'object' ? info : null;
		return hostInfo.value;
	} catch (err) {
		if (err instanceof HostError && err.status === 401) {
			signedOut.value = true;
			hostInfo.value = null;
		}
		return null;
	}
}

const win = (): Record<string, any> => (typeof window !== 'undefined' ? (window as any) : {});

/** Where record files are served from: the host's base, else the global an older shell set. */
export function filesBase(): string | undefined {
	return hostInfo.value?.filesBase ?? win().__DT_FILES__;
}

/** Where module frames are served from (`<base>/<module>/<kind>.html`). */
export function framesBase(): string | undefined {
	return hostInfo.value?.framesBase;
}

/** A host that answered a workspace id is a pane host: the pane bar, the place report and Ask in chat draw
 *  only there (reading 3 — the editor answers no id). */
export function paneHost(): boolean {
	return typeof hostInfo.value?.workspace?.id === 'string';
}
