#!/usr/bin/env node
// The published path of bin/session-save: its source is bin/session-save.ts, built into dist/bin/session-save.js (scripts/build.ts).
// argv[1] names the built file, so its run-as-a-script guard sees itself and not this shim.
import { fileURLToPath } from "node:url"
const target = new URL("../dist/bin/session-save.js", import.meta.url)
process.argv[1] = fileURLToPath(target)
await import(target.href)
