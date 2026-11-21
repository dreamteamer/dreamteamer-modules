// Which test files a run executes — collected once, then narrowed by module, by substring and by shard.
// Split from test.ts so `tests/test-shards.test.ts` can prove the partition without spawning a run.
//
// ⚠ THE ONE PROPERTY THAT MATTERS: across the shards of one run, every collected file runs EXACTLY
// once. A file no shard picks passes silently in every job, which is worse than a red build. The
// weights below only BALANCE the shards; a stale or missing weight costs wall time, never coverage.
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")

/** A test file by name: TypeScript (most suites), or JavaScript where a module still has some. */
export const TEST_FILE = /\.test\.(ts|mjs|js)$/

/** Every test file under `dir`, skipping installed and generated trees and test fixtures. */
function walk(dir: string, out: string[] = []): string[] {
  if (!fs.existsSync(dir)) return out
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === "node_modules" || e.name === "dist" || e.name === "fixtures" || e.name.startsWith(".")) continue
    const p = path.join(dir, e.name)
    if (e.isDirectory()) walk(p, out)
    else if (TEST_FILE.test(e.name)) out.push(p)
  }
  return out
}

/** Every test file in the repo, as sorted root-relative POSIX paths. */
export function collect(root = ROOT) {
  return [...walk(path.join(root, "tests")), ...walk(path.join(root, "modules"))]
    .map(f => path.relative(root, f).split(path.sep).join("/"))
    .sort()
}

/**
 * The files a module's release runs: the repo-wide checks under `tests/` (structure, leak gate, and
 * compiles-alone, which installs EVERY module from its packed tarball) plus that module's own suite.
 */
export function forModule(files: string[], id: string): string[] {
  return files.filter(f => f.startsWith("tests/") || f.startsWith(`modules/${id}/`))
}

// Seconds per file on a 2-vCPU GitHub runner, node 20, run 41100010853 (2026-10-30): the files above
// ~8 s. Everything else counts DEFAULT_WEIGHT. Re-measure when a shard runs far longer than the rest.
export const WEIGHTS: Record<string, number> = {
  "modules/proofs/test/integration/prove.test.ts": 170,
  "modules/worktrees/test/integration/land.test.ts": 65,
  "tests/compiles-alone.test.ts": 65,
  // measured 61 s on a developer machine (2026-11-14, engine 0.49 candidate, concurrency 4); re-measure on a runner
  "tests/check-alone.test.ts": 61,
  // measured 18 s on a developer machine (2026-11-14, engine 0.49 candidate): nineteen dt installs in three workspaces
  "tests/nav-workspaces.test.ts": 18,
  "modules/files/test/sync.test.ts": 45,
  "modules/worktrees/test/integration/worktrees.test.ts": 36,
  "modules/rnd/test/prototype-play.test.ts": 21,
  "modules/notebooklm/test/export.test.ts": 20,
  "modules/notebooklm/test/sync.test.ts": 16,
  "modules/rnd/test/heldout/play-fails-honestly.test.ts": 15,
  "tests/interplay.test.ts": 14,
  "modules/proofs/test/integration/extension.test.ts": 12,
  "modules/rnd/test/prototype-packed.test.ts": 10,
  "modules/workflows/test/install.test.ts": 9,
  "modules/rnd/test/prototype-schema.test.ts": 9,
  "tests/proofs-with-worktrees.test.ts": 8,
  "modules/rnd/test/heldout/minimal-app-contract.test.ts": 8,
}
export const DEFAULT_WEIGHT = 2

/**
 * A file drives a real browser when it CALLS one — rnd's `chromium()` resolver, or an import of
 * playwright itself. Code, not prose: a comment or a test name that merely says "Chromium" would put
 * a browser install in every release job (tests/ is in every one). rnd's held-out browser tests fail
 * rather than skip when no Chromium resolves, so a file this misses goes red, not quietly green.
 */
export const BROWSER_USE = /\bchromium\s*\(|\bfrom\s+['"]playwright(?:-core)?['"]/
export function needsBrowser(file: string, root = ROOT): boolean {
  return BROWSER_USE.test(fs.readFileSync(path.join(root, file), "utf8"))
}

/**
 * Shard `index` (1-based) of `total`: longest-first greedy bin packing over WEIGHTS, ties broken by
 * path, so every machine computes the same partition from the same file list. The browser files are
 * placed first, together, so only ONE shard pays for a Chromium install.
 */
export function shard(
  files: string[],
  index: number,
  total: number,
  { browser = (f: string) => needsBrowser(f) } = {}
): string[] {
  if (!Number.isInteger(total) || total < 1) throw new Error(`shard total must be a positive integer, got ${total}`)
  if (!Number.isInteger(index) || index < 1 || index > total)
    throw new Error(`shard index must be 1..${total}, got ${index}`)
  const weight = (f: string) => WEIGHTS[f] ?? DEFAULT_WEIGHT
  const byWeight = (a: string, b: string) => weight(b) - weight(a) || (a < b ? -1 : a > b ? 1 : 0)
  const bins = Array.from({ length: total }, () => ({ load: 0, files: [] as string[] }))
  const lightest = () => bins.reduce((best, b) => (b.load < best.load ? b : best), bins[0])
  const browserFiles = files.filter(browser)
  if (browserFiles.length) {
    const b = lightest()
    for (const f of browserFiles) (b.files.push(f), (b.load += weight(f)))
  }
  for (const f of files.filter(f => !browserFiles.includes(f)).sort(byWeight)) {
    const b = lightest()
    b.load += weight(f)
    b.files.push(f)
  }
  return bins[index - 1].files.sort()
}
