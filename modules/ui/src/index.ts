// The library: what a host bundles — the same exports as the Vue ui's, so a host swaps one for the other.
// The stylesheet (dist/lib/style.css) carries the icons, the tokens, the base and the Tailwind utilities the app uses.
import "@vscode/codicons/dist/codicon.css"
import "./styles/app.css"
import "./styles/ui.css"
export { mount, type MountOptions } from "./mount.tsx"
export { HostError, type Transport } from "./transport/types.ts"
export { httpTransport } from "./transport/http.ts"
