// The options every synchronous git call of the host runs with. windowsHide: a server started in the background on
// Windows has no console (spawn's detached is DETACHED_PROCESS), and a console program it starts without
// CREATE_NO_WINDOW gets a console of its own — a window per call, and a git that can hang or fail there. The timeout:
// a git that does hang must not hold the server's event loop for good (every request and the event stream with it).
import type { ExecFileSyncOptions } from "node:child_process"

export const GIT_TIMEOUT_MS = 15_000
export const GIT_SYNC: Readonly<ExecFileSyncOptions> = Object.freeze({
  stdio: ["ignore", "pipe", "ignore"] as ("ignore" | "pipe")[],
  timeout: GIT_TIMEOUT_MS,
  windowsHide: true,
})
