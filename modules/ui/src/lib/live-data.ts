/**
 * `onDataChanged(fn)`: call `fn` on every `dt:invalidate` the host posts while the calling scope lives — but
 * only under a host that draws its own nav (`__DT_HOST__.nav === 'app'`, the browser host dt web serves).
 * There the page is the only view of the workspace, so an open list or record re-reads when a record changes
 * on disk (a `dt set` in a terminal, an agent's write, a `git pull`). Under VS Code's host this is a no-op:
 * what the extension's tabs show is unchanged (cr-modules-005, acceptance line 10).
 */
import { getCurrentScope, onScopeDispose } from 'vue';

export function onDataChanged(fn: () => void): void {
	const w = window as unknown as { __DT_HOST__?: { nav?: string }; addEventListener?: Window['addEventListener']; removeEventListener?: Window['removeEventListener'] };
	if (w.__DT_HOST__?.nav !== 'app' || typeof w.addEventListener !== 'function') return;
	const listener = (e: Event) => { if ((e as MessageEvent).data?.type === 'dt:invalidate') fn(); };
	w.addEventListener('message', listener);
	if (getCurrentScope()) onScopeDispose(() => w.removeEventListener?.('message', listener));
}
