/**
 * Browser-style back/forward for the app's own history (operator ask 2026-07-29, matching
 * Obsidian's ← → in the note header).
 *
 * There is no address bar and no browser chrome here — the app runs on a MEMORY history inside a
 * webview (router.ts) — so the arrows have to be ours, and so does knowing whether they're live.
 *
 * The obvious source, `history.state.back` / `.forward`, is a dead end and cost a build to learn:
 * those keys are built by `createWebHistory`'s state helper, NOT by `createMemoryHistory`, whose
 * `state` is just whatever data was pushed. Reading them yielded `undefined` forever, so both
 * buttons rendered permanently disabled and clicking them did nothing. Position is therefore
 * tracked here: `afterEach` fires once per confirmed navigation, and the only thing we need to
 * distinguish is "we asked for this one" (our back/forward set `pendingDelta`) from "something
 * else navigated", which is a push and truncates whatever was ahead — exactly a browser's rule.
 *
 * Starts at `position: -1, length: 0` so the FIRST navigation (the app's own `/` → `/content/`
 * redirect, which fires afterEach like any other) lands at position 0 with nothing behind it,
 * rather than lighting up Back on a freshly opened tab.
 *
 * Known imprecision, deliberately not engineered around: `router.replace` (ContentDetail uses one
 * after a create) counts as a push here, because afterEach cannot distinguish it. The cost is one
 * redundant forward entry in a flow the operator is unlikely to reverse into.
 *
 * The router comes from `useRouter()` — component injection — and NOT from importing the `router`
 * singleton: router.ts imports register-defaults for its side effect, which imports the pages,
 * which import PageHeader, which imports this module. A top-level `router.afterEach()` there
 * throws during module init and blanks the entire app (cost the other build).
 */
import { readonly, ref } from 'vue';
import { useRouter } from 'vue-router';

const canBack = ref(false);
const canForward = ref(false);

let position = -1;
let length = 0;
let pendingDelta = 0;
let wired = false;

function refresh(): void {
	canBack.value = position > 0;
	canForward.value = position < length - 1;
}

export function useNavHistory() {
	const router = useRouter();

	if (!wired) {
		wired = true;
		router.afterEach((_to, _from, failure) => {
			// An aborted/redirected-away navigation never moved us; drop the intent with it.
			if (failure) {
				pendingDelta = 0;
				return;
			}
			if (pendingDelta !== 0) {
				position = Math.min(Math.max(position + pendingDelta, 0), Math.max(length - 1, 0));
				pendingDelta = 0;
			} else {
				position += 1;
				length = position + 1;
			}
			refresh();
		});
		refresh();
	}

	return {
		canBack: readonly(canBack),
		canForward: readonly(canForward),
		back: (): void => {
			if (!canBack.value) return;
			pendingDelta = -1;
			router.back();
		},
		forward: (): void => {
			if (!canForward.value) return;
			pendingDelta = 1;
			router.forward();
		},
	};
}
