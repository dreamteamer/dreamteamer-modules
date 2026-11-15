// The library: what a host bundles — the same exports as @dreamteamer/ui's, so a host swaps one for the other.
// The stylesheet (dist/lib/style.css) carries the icons, the tokens and the base.
import "@vscode/codicons/dist/codicon.css"
import "./styles/ui2.css"
export { mount, type MountOptions } from "./mount.tsx"
export { HostError, type Transport } from "./transport/types.ts"
export { httpTransport } from "./transport/http.ts"
