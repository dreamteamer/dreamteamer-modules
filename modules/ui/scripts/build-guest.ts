#!/usr/bin/env node
// The frame guest as ONE text, as the Vue ui builds it (cr-modules-008 task 4): the Vue runtime, then the
// guest — dist/guest/guest.js, with dist/guest/guest.css (this app's stylesheet, fonts inlined) and SOURCE.json
// (the Vue version). Vue, in the React app's package, on purpose: a module's prebuilt `ui/app.js` draws with
// `window.Vue`, and the frame is the module's world (src/modules/guest/guest.ts). A host reads the pair from
// here the way dt web reads the Vue ui's (`resolveGuest`).
import fs from "node:fs"
import path from "node:path"
import { createRequire } from "node:module"
import { fileURLToPath } from "node:url"
import * as esbuild from "esbuild"

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const require = createRequire(path.join(ROOT, "package.json"))
const vueDir = path.dirname(require.resolve("vue/package.json"))
const vue = fs.readFileSync(path.join(vueDir, "dist", "vue.runtime.global.prod.js"), "utf8")
const { version } = JSON.parse(fs.readFileSync(path.join(vueDir, "package.json"), "utf8"))
const out = await esbuild.build({
  entryPoints: [path.join(ROOT, "src", "modules", "guest", "guest.ts")],
  bundle: true,
  format: "iife",
  target: "es2022",
  minify: true,
  write: false,
})
const guest = `${vue}\n${out.outputFiles[0].text}`
if (/<\/script/i.test(guest)) throw new Error("the guest text contains </script — it cannot be one inline block")
const dir = path.join(ROOT, "dist", "guest")
fs.mkdirSync(dir, { recursive: true })
fs.writeFileSync(path.join(dir, "guest.js"), guest)
const css = path.join(ROOT, "dist", "lib", "style.css")
// fonts and images the stylesheet names are inlined as data: — the frame policy loads nothing by URL
const MIME: Record<string, string> = {
  ".ttf": "font/ttf",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".svg": "image/svg+xml",
  ".png": "image/png",
}
const inlined = fs.existsSync(css)
  ? fs.readFileSync(css, "utf8").replace(/url\((['"]?)([^'")]+)\1\)/g, (all, _q, ref: string) => {
      if (/^(data:|#)/.test(ref)) return all
      const file = path.resolve(path.dirname(css), ref.split(/[?#]/)[0])
      const type = MIME[path.extname(file).toLowerCase()]
      return type && fs.existsSync(file)
        ? `url(data:${type};base64,${fs.readFileSync(file).toString("base64")})`
        : "none"
    })
  : ""
fs.writeFileSync(path.join(dir, "guest.css"), inlined)
fs.writeFileSync(path.join(dir, "SOURCE.json"), JSON.stringify({ vue: version }, null, "\t") + "\n")
console.log(`built dist/guest/ (vue ${version}, ${guest.length} chars)`)
