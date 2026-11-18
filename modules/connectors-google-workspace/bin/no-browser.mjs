#!/usr/bin/env node
// The published path of bin/no-browser: its source is bin/no-browser.ts, built into dist/bin/no-browser.js (scripts/build.ts).
// argv[1] names the built file, so its run-as-a-script guard sees itself and not this shim.
import { fileURLToPath } from "node:url"
const target = new URL("../dist/bin/no-browser.js", import.meta.url)
process.argv[1] = fileURLToPath(target)
await import(target.href)
