#!/usr/bin/env node
// The path the docs and every linked workspace's pre-commit hook run (`scripts/preview.mjs guard`): the code is
// scripts/preview.ts, run through Node's type stripping (Node 22.18 or later). On a Node without it, the guard
// lets the commit through and says why — a hook never blocks a commit over its own failure.
try {
  await import("./preview.ts")
} catch (e) {
  if (process.argv.slice(2).includes("guard") && e?.code === "ERR_UNKNOWN_FILE_EXTENSION") {
    console.error(`preview guard skipped: Node ${process.version} cannot run TypeScript (22.18 or later can)`)
    process.exit(0)
  }
  throw e
}
