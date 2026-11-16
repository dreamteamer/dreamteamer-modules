// The library: what a host bundles — the same exports as the Vue ui's, so a host swaps one for the other.
// The stylesheet (dist/lib/style.css) carries the icons, the tokens, the base and the Tailwind utilities the app uses
// (styles/app.css), and the few rules for DOM a library draws (styles/vendor.css).
import "@vscode/codicons/dist/codicon.css"
import "./styles/app.css"
import "./styles/vendor.css"
export { mount, type MountOptions } from "./mount.tsx"
export { HostError, type Transport } from "./transport/HostError.ts"
export { httpTransport } from "./transport/httpTransport.ts"
