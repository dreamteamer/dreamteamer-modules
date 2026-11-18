#!/usr/bin/env node
// The published path of bin/dt-nav: its source is bin/dt-nav.ts, built into dist/bin/dt-nav.js (scripts/build.ts).
// argv[1] names the built file, so its run-as-a-script guard sees itself and not this shim.
import { fileURLToPath } from "node:url"
const target = new URL("../dist/bin/dt-nav.js", import.meta.url)
process.argv[1] = fileURLToPath(target)
await import(target.href)
