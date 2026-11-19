/**
 * WHAT A SAVE ANSWERED, as the layout drawer shows it BESIDE the button that was pressed — pure, so
 * the wording is pinned by a test rather than by a screenshot.
 *
 * The refusals are the ENGINE's, and they are right: an id that is not a slug, a view another module
 * already ships under that id, a module `npm install` would erase, a descriptor the compile rejects.
 * What hid them was where they were drawn (a status line at the bottom of a scrolling drawer, below
 * the fold), and that a sentence alone does not say what to do next. So an answer is the engine's
 * first line verbatim, the rest of its message as detail, and ONE next action — the one the refusal
 * implies — that the drawer can offer as a button where it has one to offer.
 */

/** A next step the drawer can take for the person, or `null` when the step is theirs to take. */
export type NextAction = 'rename' | 'pick-module' | null;

export interface SaveAnswer {
	tone: 'ok' | 'error';
	/** The engine's first line, or the drawer's own sentence for a success. */
	sentence: string;
	/** The rest of the engine's message — the paths, the remedy it spelled out. */
	detail?: string;
	/** What to do now, in words. Always present on a refusal. */
	next?: { label: string; action: NextAction };
}

/** A refusal: the engine's message, and the one next action it implies. */
export function refusalAnswer(err: unknown, { saveAs }: { saveAs: boolean }): SaveAnswer {
	const text = (err instanceof Error ? err.message : String(err)).trim();
	const [first, ...rest] = text.split('\n');
	const detail = rest.join('\n').trim() || undefined;
	return { tone: 'error', sentence: (first ?? '').trim() || 'The save failed.', ...(detail ? { detail } : {}), next: nextFor(text, saveAs) };
}

function nextFor(text: string, saveAs: boolean): NonNullable<SaveAnswer['next']> {
	if (/name collision|already exists/i.test(text)) {
		return saveAs
			? { label: 'Rename the view, or save it to another module', action: 'rename' }
			: { label: 'Save it under another name — Save as…', action: 'rename' };
	}
	if (/invalid ui-view id|lowercase slug/i.test(text)) return { label: 'Rename it: letters, digits and hyphens', action: 'rename' };
	if (/node_modules|npm install/i.test(text)) {
		return saveAs
			? { label: 'Pick a module whose sources are here', action: 'pick-module' }
			: { label: 'Save it under another name, or disable it and re-create it', action: 'rename' };
	}
	return { label: 'Fix what the compiler names, then save again', action: null };
}

/** What a successful save says — and, for a write that became an overlay, that it did. */
export function savedAnswer(kind: 'view' | 'new-view' | 'collection', out: Record<string, unknown> | undefined, extra?: { route?: string; module?: string | null; unsaved?: string[] }): SaveAnswer {
	const overlay = out?.['overlay'] === true;
	if (kind === 'new-view') {
		const where = extra?.module ? ` in ${extra.module}` : '';
		return { tone: 'ok', sentence: `Saved${where} — '${extra?.route ?? ''}' is live.` };
	}
	if (kind === 'view') {
		if (overlay && out?.['removed']) return { tone: 'ok', sentence: 'View saved — it matches the shipped view again, so the workspace overlay was removed.' };
		return overlay
			? { tone: 'ok', sentence: 'View saved to the workspace module as an overlay — it takes precedence over the shipped view, which is untouched.' }
			: { tone: 'ok', sentence: 'View updated.' };
	}
	// a display overlay may also have declared the collection a peer of the workspace module — a write
	// to that module's package.json, so the answer says it (review finding peer-write-unannounced)
	const peer = out?.['peer'] as { collection?: string; module?: string } | undefined;
	const declared = peer?.collection && peer.module ? `, and declared ${peer.collection} as a peer collection of ${peer.module}` : '';
	const base = overlay
		? `Saved to the collection — as an overlay in the workspace module${declared}; the package's own display is untouched.`
		: 'Saved to the collection.';
	if (extra?.unsaved?.length) {
		return { tone: 'ok', sentence: base, detail: `A collection's own display does not hold a ${extra.unsaved.join(', ')} — use Save as… to keep it.` };
	}
	return { tone: 'ok', sentence: base };
}
