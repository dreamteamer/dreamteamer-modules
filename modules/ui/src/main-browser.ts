// THE BROWSER PAGE: the app for a host with no editor around it (dt web, the playground) over the HTTP
// transport. The boot values come from GET /host before mount; a page whose session is gone mounts anyway and
// draws the signed-out sentence.
import { httpTransport, mount } from "./index.ts"
import { loadHost } from "./lib/host.ts"

const transport = httpTransport()
void loadHost((method, path, body) => transport.request(method, path, body)).then(() => mount("#app", { transport }))
