import { spawn } from "node:child_process"

/** An MCP result as the bridge's callers read it: a tool call's content, or a page of the tool catalog. */
export interface McpResult {
  isError?: boolean
  content?: { type: string; text?: string }[]
  tools?: { name: string; [key: string]: unknown }[]
  nextCursor?: string
  [key: string]: unknown
}

/** The bridge `connect` returns. */
export interface McpConnection {
  ready(): Promise<void>
  send(method: string, params?: Record<string, unknown>): Promise<McpResult>
  close(): void
}

// JSON-RPC over MCP's newline-delimited stdio transport. Server diagnostics stay private.
export function connect({
  platform = process.platform,
  command = "uvx",
  args = [
    "--with",
    "python-dotenv==1.2.3",
    "workspace-mcp==2.4.2",
    "--transport",
    "stdio",
    "--tools",
    "gmail",
    "drive",
    "calendar",
  ],
  env = process.env,
  timeoutMs = 30000,
  spawnProcess = spawn as typeof spawn,
} = {}): McpConnection {
  if (platform === "win32")
    throw new Error(
      "The MCP bridge is not supported on Windows: its manual-browser boundary is not verified. No server was started."
    )
  const child = spawnProcess(command, args, { env, stdio: ["pipe", "pipe", "pipe"], shell: false })
  const pending = new Map<
    number,
    { resolve: (r: McpResult) => void; reject: (e: Error) => void; timer: NodeJS.Timeout }
  >()
  let nextId = 0,
    buffer = "",
    stopped = false
  const fail = (message: string) => {
    stopped = true
    for (const p of pending.values()) {
      clearTimeout(p.timer)
      p.reject(new Error(message))
    }
    pending.clear()
  }
  child.on("error", () => fail("MCP process could not start; check the local runtime installation."))
  child.on("exit", () => fail("MCP process exited before completing the request."))
  child.stdin.on("error", () => fail("MCP input stream closed."))
  child.stderr.on("data", () => {})
  child.stdout.on("data", chunk => {
    buffer += chunk.toString()
    if (buffer.length > 16 * 1024 * 1024) {
      fail("MCP response exceeds the buffer limit.")
      child.kill()
      return
    }
    const lines = buffer.split("\n")
    buffer = lines.pop()
    for (const line of lines) {
      let msg
      try {
        msg = JSON.parse(line)
      } catch {
        continue
      }
      const p = pending.get(msg.id)
      if (!p) continue
      pending.delete(msg.id)
      clearTimeout(p.timer)
      if (msg.error) p.reject(new Error("MCP server returned a protocol error."))
      else p.resolve(msg.result)
    }
  })
  const send = (method: string, params: Record<string, unknown> = {}) =>
    new Promise<McpResult>((resolve, reject) => {
      if (stopped) {
        reject(new Error("MCP process is closed."))
        return
      }
      const id = ++nextId
      const timer = setTimeout(() => {
        pending.delete(id)
        reject(new Error("MCP request timed out."))
        fail("MCP request timed out.")
        child.kill()
      }, timeoutMs)
      pending.set(id, { resolve, reject, timer })
      child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n")
    })
  const ready = async () => {
    await send("initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "dt-google", version: "0.1.0" },
    })
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n")
  }
  return {
    ready,
    send,
    close() {
      fail("MCP process closed.")
      child.kill()
    },
  }
}
