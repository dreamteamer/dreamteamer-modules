/**
 * The host draws the app's own shell — the nav on the canvas, the page a sheet laid on it, tabs, search, toasts (dt web:
 * `__DT_HOST__.nav === "app"`). Inside VS Code the editor is the shell: the app keeps its plain frame and draws none of
 * that. Read once — a host declares it before the bundle runs.
 */
interface HostFlags {
  nav?: "app"
  commands?: boolean
  openFile?: "tab"
  tabs?: boolean
  history?: "hash"
}

const flags = (): HostFlags | undefined =>
  typeof window !== "undefined" ? (window as unknown as { __DT_HOST__?: HostFlags }).__DT_HOST__ : undefined

export const appShell: boolean = flags()?.nav === "app"

/** The sheet draws its own tab strip unless the host keeps tabs itself (`__DT_HOST__.tabs === true`). */
export const appTabs: boolean = appShell && flags()?.tabs !== true
