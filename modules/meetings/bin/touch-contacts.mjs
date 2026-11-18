#!/usr/bin/env node
// The published path of bin/touch-contacts: its source is bin/touch-contacts.ts, built into dist/bin/touch-contacts.js (scripts/build.ts).
// argv[1] names the built file, so its run-as-a-script guard sees itself and not this shim.
import { fileURLToPath } from "node:url"
const target = new URL("../dist/bin/touch-contacts.js", import.meta.url)
process.argv[1] = fileURLToPath(target)
await import(target.href)
