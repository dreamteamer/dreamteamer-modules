/**
 * The display contract's collection rows → the `/collections` overview rows every surface reads.
 *
 * Its own module, importing NOTHING, for two reasons that point the same way: the carry below is a
 * decision worth a test, and `adapter.ts` cannot be imported by one — it pulls in `transport.ts`,
 * which registers a `window` listener at module scope. Same reasoning as `lib/schema-rail.ts`.
 */
import type { CollectionRow } from './types';

/** A collection row exactly as the engine's `presentation()` emits it (descriptor v2, §4.3). */
export type PresentationCollection = Omit<CollectionRow, 'provenance' | 'layer'>;

/**
 * ⚠ THE KEYS ARE NAMED, NOT SPREAD, so a key the engine adds is a contract change this function has
 * to be told about — the engine's own `presentation-contract.test.js` pins the same list from the
 * other side. Everything named is carried VERBATIM: `display` is already resolved by the engine, and
 * a default re-derived here would be a second answer to one question.
 *
 * ⚠ A KEY DROPPED HERE IS INVISIBLE DOWNSTREAM: a consumer can derive perfectly from a field that
 * never arrives, with every suite green. The Schema tab's left rail derives from `internal`, and
 * losing it here leaves `repos` folded out of the record tree and absent from the rail as well
 * (`test/unit/schema-rail.test.ts` runs this function into the rail for exactly that reason).
 *
 * ⚠ AND BOTH ANSWERS ARE CARRIED, BECAUSE THEY ARE TWO QUESTIONS. `runtime` is build output, which
 * decides HOW A WRITE IS PERFORMED; `internal` is whether the collection is plumbing rather than a
 * domain noun — WHERE IT IS DRAWN. They agree for every engine kind except `repos`, plumbing whose
 * records are ordinary files under `data/`. Never fold one into the other here.
 *
 * Plus the two constants the components expect: `provenance: 'disk'` (lib/okf.ts isOkfRow's "real
 * registered collection" marker) and `layer: ''` (= the local workspace).
 */
export function collectionRows(rows: readonly PresentationCollection[]): CollectionRow[] {
	return rows.map((c) => ({
		collection: c.collection,
		title: c.title,
		nav: c.nav,
		list: c.list,
		record: c.record,
		form: c.form,
		...(c.position_field === undefined ? {} : { position_field: c.position_field }),
		record_title: c.record_title,
		record_type: c.record_type,
		runtime: c.runtime,
		internal: c.internal,
		// the host's own key, not the engine's: every root the collection reads, named (0.24.0)
		...(c.sources === undefined ? {} : { sources: c.sources }),
		provenance: 'disk',
		layer: '',
	}));
}
