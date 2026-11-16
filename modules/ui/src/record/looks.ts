/**
 * THE RECORD PAGE'S SHARED LOOKS — class strings several of the record page's parts draw with (the side panel's
 * tabs, the properties, the page views). What the whole app shares lives in `styles/classes.ts`.
 */

/** A small capitalised heading over a group: a properties section, an options block, an info term. */
export const capsLabel = "text-small font-semibold uppercase tracking-[0.04em] text-fg-subtle"

/** A button that reads as a link, quiet when disabled. (was dt-link-button dt-link) */
export const linkAction =
  "inline-flex items-center gap-1 bg-transparent border-0 p-0 [text-transform:inherit] [letter-spacing:inherit] cursor-pointer text-link disabled:text-fg-subtle disabled:cursor-default"

/** A computed value: it and everything in it dimmed — over a View's own colours (a chip, a link), as it always
 *  was. (was dt-computed) */
export const computed = "text-fg-subtle [&_*]:text-fg-subtle!"

/** A dialog's paragraph: the dialog sets no margins on its text. */
export const dialogText = "m-0"

/** A section's heading over its properties or form fields. (was dt-props-section) */
export const sectionHead = "mt-0 mx-0 mb-1 pl-1 text-small font-semibold uppercase tracking-[0.04em] text-fg-subtle"
/** …a collapsible section's: the heading as a button with its chevron. (was dt-props-section dt-link-button) */
export const sectionToggle =
  "inline-flex items-center gap-1 bg-transparent border-0 cursor-pointer mt-0 mx-0 mb-1 py-0 pr-0 pl-1 text-small font-semibold uppercase tracking-[0.04em] text-fg-subtle"
