// The engine extension: `dt serve [--port <n>] [--host <addr>] [--token <secret>]`. Activation binds the running engine
// and nothing else — no port is bound and nothing is printed until the verb runs.
import type { Contribution } from "dreamteamer"
import { bind, dt, type Api } from "./engine.ts"
import type http from "node:http"
import { assertExposure, serve } from "./createApp.ts"

export const apiVersion = 1

const USAGE = `  serve [--port <n>] [--host <addr>] [--token <secret>]   the REST api at /api (default 127.0.0.1:8080; --port 0 picks a free port; a --host beyond loopback needs --token)`

/** `--port`, `--host` and `--token`, each spaced or with `=`; anything else is refused, and so is a
 *  host beyond loopback without a token. */
/** What `dt serve` was asked for. */
export interface ServeOptions {
  port: number
  host: string
  token?: string
}

export function parseServeArgs(argv: string[]): ServeOptions {
  const out: ServeOptions = { port: 8080, host: "127.0.0.1" }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    const m = /^--(port|host|token)(?:=(.*))?$/.exec(a)
    if (!m)
      throw new Error(
        `\`dt serve\` does not take "${a}" — usage: dt serve [--port <n>] [--host <addr>] [--token <secret>]`
      )
    const value = m[2] ?? argv[++i]
    if (value === undefined || value === "" || (m[2] === undefined && value.startsWith("--")))
      throw new Error(`--${m[1]} needs a value`)
    if (m[1] === "port") {
      if (!/^\d+$/.test(value) || Number(value) > 65535)
        throw new Error(`--port must be a number from 0 to 65535 (got "${value}")`)
      out.port = Number(value)
    } else out[m[1] as "host" | "token"] = value
  }
  assertExposure(out.host, out.token)
  return out
}

export default function activate(api: Api): Contribution {
  bind(api)
  return {
    commands: {
      serve: {
        usage: USAGE,
        async run(ws, argv) {
          const opts = parseServeArgs(argv)
          dt.warnIfStale(ws.root)
          const server: http.Server = await serve(ws, opts)
          // the verb's promise IS the process lifetime: it settles only when the server closes
          await new Promise(resolve => server.once("close", resolve))
          return 0
        },
      },
    },
  }
}
