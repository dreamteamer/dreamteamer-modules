// What an html field is: the one test the desktop app, this module's check and verbs, and the NotebookLM export
// all apply. No engine ships a field type `html`; the second half of the test is there for the day one does.

/** A field drawn as a page: its `display.viewer` is `html`, or its `type` is `html`. */
export function isHtmlField(field: unknown): boolean {
  if (!field || typeof field !== "object") return false
  const f = field as { type?: unknown; display?: unknown }
  if (f.type === "html") return true
  return !!f.display && typeof f.display === "object" && (f.display as { viewer?: unknown }).viewer === "html"
}

/** The names of the html fields in a descriptor's field map, in its order. */
export function htmlFieldsOf(fields: unknown): string[] {
  if (!fields || typeof fields !== "object") return []
  return Object.entries(fields as Record<string, unknown>)
    .filter(([, f]) => isHtmlField(f))
    .map(([name]) => name)
}
