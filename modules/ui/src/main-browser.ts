// THE BROWSER PAGE: the app for a host with no editor around it (dt web, the playground) over the HTTP
// transport. It adds browser.css (the warm light and dark sets, the chart and ANSI colours) and declares the host's
// shell when the host did not. The boot values come from GET /host before mount; a page whose session is gone
// mounts anyway and draws the signed-out sentence.
import { httpTransport, mount } from "./index.ts"
import { loadHost } from "./lib/host.ts"
import "./styles/browser.css"

const w = window as unknown as { __DT_HOST__?: Record<string, unknown> }
w.__DT_HOST__ ??= { nav: "app", commands: false, openFile: "tab", tabs: false, history: "hash" }

const transport = httpTransport()
void loadHost((method, path, body) => transport.request(method, path, body)).then(() => mount("#app", { transport }))
