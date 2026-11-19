import fs from "node:fs"
import path from "node:path"

/**
 * The file an engine package resolves `subpath` to (`"."` the public API, `"./records"` the records API): its
 * package.json `exports`, else `main` — never a path guessed here. An engine through 0.49 answers `src/api.js`,
 * a TypeScript engine `dist/api.js`; both say so in their manifest. Null when it names none that exists.
 */
export function engineEntry(base: string, subpath = "."): string | null {
  const pick = (e: unknown): string | null =>
    typeof e === "string"
      ? e
      : e && typeof e === "object"
        ? (pick((e as Record<string, unknown>).import) ??
          pick((e as Record<string, unknown>).node) ??
          pick((e as Record<string, unknown>).default))
        : null
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(base, "package.json"), "utf8"))
    const exported = pkg.exports && typeof pkg.exports === "object" ? pick(pkg.exports[subpath]) : null
    const target = exported ?? (subpath === "." && typeof pkg.main === "string" ? pkg.main : null)
    const file = target ? path.join(base, target) : null
    return file && fs.existsSync(file) ? file : null
  } catch {
    return null
  }
}
