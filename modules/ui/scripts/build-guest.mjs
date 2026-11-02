#!/usr/bin/env node
// cr-modules-008 task 4: the frame guest as ONE text — the Vue runtime the app pins, then the guest — written to
// dist/guest/guest.js, with dist/guest/guest.css (the app's stylesheet) and SOURCE.json (the Vue version).
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(path.join(ROOT, 'package.json'));
const vueDir = path.dirname(require.resolve('vue/package.json'));
const vue = fs.readFileSync(path.join(vueDir, 'dist', 'vue.runtime.global.prod.js'), 'utf8');
const { version } = JSON.parse(fs.readFileSync(path.join(vueDir, 'package.json'), 'utf8'));
const out = await esbuild.build({ entryPoints: [path.join(ROOT, 'src', 'modules', 'guest', 'guest.ts')], bundle: true, format: 'iife', target: 'es2022', minify: true, write: false });
const guest = `${vue}\n${out.outputFiles[0].text}`;
if (/<\/script/i.test(guest)) throw new Error('the guest text contains </script — it cannot be one inline block');
const dir = path.join(ROOT, 'dist', 'guest');
fs.mkdirSync(dir, { recursive: true });
fs.writeFileSync(path.join(dir, 'guest.js'), guest);
const css = path.join(ROOT, 'dist', 'lib', 'style.css');
fs.writeFileSync(path.join(dir, 'guest.css'), fs.existsSync(css) ? fs.readFileSync(css, 'utf8') : '');
fs.writeFileSync(path.join(dir, 'SOURCE.json'), JSON.stringify({ vue: version }, null, '\t') + '\n');
console.log(`built dist/guest/ (vue ${version}, ${guest.length} chars)`);
