#!/usr/bin/env node
// The published path of bin/event-people: its source is bin/event-people.ts, built into dist/bin/event-people.js (scripts/build.ts).
// argv[1] names the built file, so its run-as-a-script guard sees itself and not this shim.
import { fileURLToPath } from "node:url"
const target = new URL("../dist/bin/event-people.js", import.meta.url)
process.argv[1] = fileURLToPath(target)
await import(target.href)
