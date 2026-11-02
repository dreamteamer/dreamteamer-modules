/**
 * Tiny local title-casing util for field labels. Deliberately NOT an off-the-shelf format-title
 * package: pulling in a dependency for what's a one-line
 * split+capitalize job would add weight the studio doesn't otherwise need. Split on
 * '_'/'-'/whitespace, capitalize each word: 'due_date' -> 'Due Date', 'assignee-id' -> 'Assignee Id'.
 */
export function formatTitle(field: string): string {
	return field
		.split(/[_\-\s]+/)
		.filter(Boolean)
		.map((word) => word.charAt(0).toUpperCase() + word.slice(1))
		.join(' ');
}

/**
 * The label to show for a field. `title` is resolved by the ENGINE onto every field row of the
 * display contract (an authored `title:`, else title-cased from the name), so components render that
 * rather than title-casing an identifier themselves. `formatTitle` covers the rows THIS extension
 * builds for its own registry options, which carry a name and no title.
 */
export function labelOf(field: { field: string; title?: string }): string {
	return field.title ? field.title : formatTitle(field.field);
}
