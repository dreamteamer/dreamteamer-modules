/**
 * The record layer a PAGE view is scoped to (`?source=`), handed from the page to every panel under it — what a
 * `counts` number carries in its link, so a click lands on the same rows it counted (the Vue ui's
 * PAGE_SOURCE injection key, as a React context).
 */
import { createContext } from "react"

export const PageSource = createContext<string | undefined>(undefined)
