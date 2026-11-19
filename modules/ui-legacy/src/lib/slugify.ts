/**
 * Pure string helpers for the create-collection dialog (phase D): the live slug preview and the
 * default record-type-suffix guess. Both mirror server behavior on purpose —
 * `slugify` matches the collection-path segment rule the server enforces
 * (`server/src/services/schema-writer.ts`'s `SEGMENT_RE = /^[a-zA-Z0-9_][a-zA-Z0-9_-]*$/`, dashes
 * only, no leading dash/digit-only weirdness beyond what that regex already allows) and
 * `defaultRecordType` mirrors `server/src/workspace/descriptors.ts`'s `defaultRecordType`
 * (singularize the last path segment by stripping a trailing 's') so the dialog's live preview
 * never disagrees with what the server would have picked anyway.
 */

/** Lowercase, dash-separated slug: strips anything that isn't alphanumeric/dash/underscore,
 * collapses whitespace/underscores to a single dash, trims leading/trailing dashes. */
export function slugify(text: string): string {
	return text
		.toLowerCase()
		.trim()
		.replace(/['"]/g, '')
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '');
}

/** Singularize a collection name's last segment for the record-type default guess (naive
 * trailing-'s' strip — same heuristic the server falls back to when `record_type` is omitted). */
export function defaultRecordType(name: string): string {
	const base = name.split('/').pop() ?? name;
	return base.replace(/s$/, '') || base;
}

/** Join an optional parent namespace + a slug into a full collection path (posix `/`-joined). */
export function joinCollectionPath(parent: string, slug: string): string {
	const trimmedParent = parent.replace(/^\/+|\/+$/g, '');
	return trimmedParent ? `${trimmedParent}/${slug}` : slug;
}
