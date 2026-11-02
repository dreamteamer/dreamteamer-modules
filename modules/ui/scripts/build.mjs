#!/usr/bin/env node
// Two builds of one source:
//   dist/lib/   the library a host bundles — index.js (`mount`, the transports), index.d.ts, style.css
//   dist/app/   the browser page a web host serves — index.html + assets/, over the HTTP transport
// Both relative (`base: './'`): the VS Code webview rewrites `./assets/*` to webview URIs, and dt web
// serves the page at `/`.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';
import vue from '@vitejs/plugin-vue';

const UI = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(UI, 'src');
const DIST = path.join(UI, 'dist');

const common = {
	configFile: false,
	root: SRC,
	base: './',
	plugins: [vue()],
	logLevel: 'error',
};

await build({
	...common,
	// an application build with its entry's exports kept, rather than vite's library mode: library mode
	// leaves an ES bundle unminified, comments and all, and a host re-bundles this anyway
	build: {
		outDir: path.join(DIST, 'lib'),
		emptyOutDir: true,
		chunkSizeWarningLimit: 4000,
		rollupOptions: {
			input: path.join(SRC, 'index.ts'),
			preserveEntrySignatures: 'exports-only',
			output: {
				entryFileNames: 'index.js',
				chunkFileNames: 'assets/[name]-[hash].js',
				assetFileNames: (a) => (a.names?.some((n) => n.endsWith('.css')) ? 'style.css' : 'assets/[name]-[hash][extname]'),
			},
		},
	},
});

fs.writeFileSync(path.join(DIST, 'lib', 'index.d.ts'), `export interface Transport {
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
`);

await build({
	...common,
	build: {
		outDir: path.join(DIST, 'app'),
		emptyOutDir: true,
		chunkSizeWarningLimit: 4000,
		rollupOptions: { input: path.join(SRC, 'index.html') },
	},
});

console.log('built dist/lib/ and dist/app/');
await import('./build-guest.mjs');
