/**
 * `<input type="date">` / `<input type="datetime-local">` value plumbing, shared by the record
 * editor (EditDatetime) and the filter panel (FilterBuilder).
 *
 * It exists because those two had drifted: the editor converted correctly and the filter bound the
 * stored ISO string straight into `:value`. A `datetime-local` input accepts EXACTLY
 * `YYYY-MM-DDTHH:mm[:ss]` — hand it `2026-07-28T12:00:00+03:00` and it silently renders blank, so
 * setting a time in the filter panel looked like the value hadn't stuck.
 *
 * Direction of travel:
 *   stored → widget   `toLocalInputValue` (parse the instant, render it in the viewer's zone)
 *   widget → stored   `fromLocalInputValue` (hand the engine the raw local wall clock)
 *
 * The write side deliberately does NOT convert to ISO. The engine's `src/temporal.js` stamps the
 * local offset on during validation, so `2026-07-28T12:00` is already a legal thing to send — and
 * sending it means the studio and a `dreamteamer <c> set` invocation produce a byte-identical
 * record. Converting here would be a second implementation of a normalization the engine owns, and
 * a lossier one: `new Date(...).toISOString()` throws the offset away and writes `09:00Z` for a
 * meeting the operator entered, and will re-read, as noon.
 */

function pad(n: number): string {
	return String(n).padStart(2, '0');
}

/** Stored value → what the widget can display. `''` for anything unparseable, which blanks it. */
export function toLocalInputValue(value: unknown, dateOnly: boolean): string {
	if (typeof value !== 'string' || !value) return '';

	// A date-only field is a calendar day, not an instant: take the day AS WRITTEN rather than
	// round-tripping through Date, which would resolve `2026-07-28` at UTC midnight and hand back
	// the 27th to anyone west of Greenwich.
	if (dateOnly) return value.slice(0, 10);

	const date = new Date(value);
	if (Number.isNaN(date.getTime())) {
		// Not yet a full timestamp — most likely a half-typed `2026-07-` the input is mid-edit on.
		// Echo it back rather than blanking the field out from under the operator.
		return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(value) ? value.slice(0, 16) : '';
	}
	return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** Widget → what we send. Empty clears the field; otherwise the raw wall clock, offset-free. */
export function fromLocalInputValue(raw: string): string | null {
	return raw ? raw : null;
}
