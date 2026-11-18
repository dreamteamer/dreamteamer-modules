/**
 * What the New collection dialog sends — pure, so the v2 shape is a test (descriptor v2, §3.4, §4.2).
 *
 * A collection starts from `mixins` (`--mixins docs,entity`): partial descriptors merged at compile,
 * in list order, so the dialog offers every compiled `mixins` record and keeps the order they were
 * ticked in. How its ids are made is `ids.from` (`--id-from '{{ … }}'`), blank for the engine's
 * default. Neither is sent when empty: the engine's own default is the honest answer then.
 */
export interface MixinChoice {
	id: string;
	/** What to call it: its `title`, else its id. */
	label: string;
	/** Its `description` — what it adds. */
	description?: string;
}

/** The compiled `mixins` records as dialog choices, by label. */
export function mixinChoices(records: Array<Record<string, unknown>>): MixinChoice[] {
	return records
		.map((r) => ({
			id: String(r['id']),
			label: typeof r['title'] === 'string' && r['title'] ? (r['title'] as string) : String(r['id']),
			...(typeof r['description'] === 'string' && r['description'] ? { description: r['description'] as string } : {}),
		}))
		.sort((a, b) => a.label.localeCompare(b.label));
}

/** Tick or untick one mixin, keeping the order the operator ticked them in — compile applies them in it. */
export function toggleMixin(picked: string[], id: string): string[] {
	return picked.includes(id) ? picked.filter((m) => m !== id) : [...picked, id];
}

/** The body of `POST /collections/collections/records`. */
export function createCollectionBody(name: string, mixins: string[], idFrom: string): { name: string; mixins?: string[]; idFrom?: string } {
	const from = idFrom.trim();
	return { name, ...(mixins.length ? { mixins: [...mixins] } : {}), ...(from ? { idFrom: from } : {}) };
}
