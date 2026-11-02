/**
 * Icon names: ONE vocabulary, codicons.
 *
 * ⚠ This replaces a 3.8 MB Material Symbols font (3,895 glyphs, ~40 in use) with VS Code's own
 * 148 KB codicon set — and, more importantly, deletes the second vocabulary. The native tree can
 * only draw codicons, so a material name in a descriptor had to be TRANSLATED for the tree while
 * the webview drew it directly; that map was hand-maintained, and an unmapped name fell back to a
 * generic cylinder with no error. One set both halves can draw means nothing to keep in sync.
 *
 * `LEGACY` stays because a descriptor is DATA: a workspace written before this change (or copied
 * from a recipe that was) still carries material names, and silently drawing the fallback glyph is
 * the failure this whole change exists to end. It is a compatibility shim, not a vocabulary —
 * nothing in this repo may add to it, and new icons are codicon names.
 */
/** The glyph to draw for a descriptor's `icon:` — a codicon name, or the legacy translation. */
export declare function codiconFor(name?: string | null): string;
