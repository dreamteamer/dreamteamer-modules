#!/usr/bin/env node
// Two builds of one source, as @dreamteamer/ui makes them:
//   dist/lib/   the library a host bundles — index.js (`mount`, the transports), index.d.ts, style.css
//   dist/app/   the browser page a web host serves — index.html + assets/, over the HTTP transport
// Both relative (`base: './'`), so a webview can rewrite `./assets/*` and a web host can serve the page at `/`.
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { build, type InlineConfig } from "vite"
import react from "@vitejs/plugin-react"

const UI2 = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const SRC = path.join(UI2, "src")
const DIST = path.join(UI2, "dist")

const common: InlineConfig = {
  configFile: false,
  root: SRC,
  base: "./",
  plugins: [react()],
  logLevel: "error",
}

await build({
  ...common,
  build: {
    outDir: path.join(DIST, "lib"),
    emptyOutDir: true,
    chunkSizeWarningLimit: 2000,
    rollupOptions: {
      input: path.join(SRC, "index.ts"),
      preserveEntrySignatures: "exports-only",
      output: {
        entryFileNames: "index.js",
        chunkFileNames: "assets/[name]-[hash].js",
        assetFileNames: a => (a.names?.some(n => n.endsWith(".css")) ? "style.css" : "assets/[name]-[hash][extname]"),
      },
    },
  },
})

fs.writeFileSync(
  path.join(DIST, "lib", "index.d.ts"),
  `export interface Transport {
	request(method: string, path: string, body?: unknown): Promise<unknown>;
	notify(type: string, payload?: unknown): void;
	setState?(state: unknown): void;
}
export declare class HostError extends Error {
	status: number;
	constructor(message: string, status: number);
}
export interface MountOptions {
	transport: Transport;
}
export declare function mount(el: string | Element, options: MountOptions): Promise<void>;
export declare function httpTransport(): Transport;
`
)

await build({
  ...common,
  build: {
    outDir: path.join(DIST, "app"),
    emptyOutDir: true,
    chunkSizeWarningLimit: 2000,
    rollupOptions: { input: path.join(SRC, "index.html") },
  },
})

console.log("built dist/lib/ and dist/app/")
