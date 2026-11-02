// ACTIVITY — what happened to a module, by whom, read from git: one entry per commit, naming its
// author, its message and the records it touched (operator 2026-10-29: "the module inspector should
// load first; top page should be activity, show named activity from git for the module").
//
// Not the engine's `deriveEvents`: that answers WHICH records changed between two points (a diff,
// for the change pipeline), with no commit or author per change. A feed is a log, so this is a log —
// one `git log` per repo, newest first, capped.
//
// WHICH HISTORY IS A MODULE'S (moduleScope): the repo holding its sources, found by walking up to
// the nearest `.git`. A module that IS a clone (a `git_modules` bundle, a layer attached as a module)
// owns its clone's whole history — its sources and its records live there. The workspace module owns
// the workspace repo's. Any other inline module owns its own folder plus the record folders of the
// collections it ships. An npm-installed module has no history of its OWN here — narrowed to it, its
// history is its RECORDS': the record folders of the collections it ships, asked of each repo holding
// one (`recordScopes`; cr: nested ui-views — a package module's page nests this feed, and "no history"
// was all it could have said). `?source=<root name>` keeps the scopes of one repo (api.ts).
import * as fs from "node:fs";
import * as path from "node:path";
import { execFile } from "node:child_process";
/** The repo holding `rel` (workspace-relative): the nearest ancestor with a `.git`, `.` at the top. */
export function repoOf(root, rel) {
    let dir = rel.replace(/\/+$/, "");
    while (dir && dir !== ".") {
        if (fs.existsSync(path.join(root, dir, ".git")))
            return dir;
        const up = path.posix.dirname(dir);
        if (up === dir)
            break;
        dir = up;
    }
    return ".";
}
/**
 * The history of a set of record folders (workspace-relative): one scope per repo holding any of them —
 * the workspace's own `data/`, each record layer's clone — with that repo's folders as its pathspecs.
 * What an npm-installed module's page reads (`api.ts`), since the module has no history of its own here.
 */
export function recordScopes(root, dirs) {
    const byRepo = new Map();
    for (const dir of dirs) {
        const repo = repoOf(root, dir);
        const paths = byRepo.get(repo) ?? [];
        if (!paths.includes(dir))
            paths.push(dir);
        byRepo.set(repo, paths);
    }
    return [...byRepo].map(([repo, paths]) => ({ repo, paths }));
}
/**
 * A module's history: the repo and the pathspecs inside it. `recordDirsOf` gives the workspace-relative
 * record folders of the collections the module ships (only asked for an inline, non-workspace module).
 * Undefined for a module with no git history — an npm install.
 */
export function moduleScope(root, module, workspaceModule, recordDirsOf) {
    const rel = module.path?.replace(/\/+$/, "");
    if (!rel || module.location === "node_modules" || rel.split("/").includes("node_modules"))
        return undefined;
    const repo = repoOf(root, rel);
    if (repo !== "." || module.id === workspaceModule)
        return { repo, paths: [] };
    const paths = [rel, ...recordDirsOf(module.id).filter((d) => repoOf(root, d) === ".")];
    return { repo, paths: [...new Set(paths)] };
}
/**
 * A repo's name, as a source is named (`src/sources.ts`): the workspace's own name for `.`, the
 * clone's `git_modules` key for one under it — the word, and so the dot colour, its records carry.
 */
export function repoName(repo, workspace) {
    if (repo === ".")
        return workspace;
    const parts = repo.split("/");
    return parts[0] === "git_modules" && parts[1] ? parts[1] : parts[parts.length - 1];
}
/** `git log --format=%x01%H%x02%aI%x02%an%x02%s --name-only` → one entry per commit, files kept as paths. */
export function parseActivityLog(out, repo) {
    const entries = [];
    for (const line of out.split("\n")) {
        if (line.startsWith("\x01")) {
            const [sha = "", date = "", author = "", subject = ""] = line.slice(1).split("\x02");
            entries.push({ sha, repo, author, date, subject, paths: [] });
            continue;
        }
        if (line && entries.length)
            entries[entries.length - 1].paths.push(line);
    }
    return entries;
}
/** The first page (operator 2026-10-31: "do a first page (change to 20) limited git query"). */
export const ACTIVITY_PAGE = 20;
/** The longest one request waits for a scope before answering without it; the pane names the repo as
 *  still being read and asks again, and the read it started carries on. */
export const ACTIVITY_BUDGET_MS = 3000;
/** Once something new is in, how long the rest get to join the same answer — so repos answering
 *  milliseconds apart are one round trip rather than one each. */
export const ACTIVITY_GRACE_MS = 150;
/** A `git log` running this long is killed and its repo named as unread, so a hung git never leaves
 *  the page polling forever. */
export const ACTIVITY_GIT_TIMEOUT_MS = 60_000;
/** How long an ANSWERED read stays for follow-ups to join. A new visit re-reads anyway, so this only
 *  bounds what the host holds after the pane stops asking; expired at the next request, never on a
 *  timer. Its own number, not the kill timeout's, though they happen to agree. */
export const ACTIVITY_READ_RETENTION_MS = 60_000;
/** `git log` for a scope, newest first, `limit` commits — pathspecs made relative to the scope's repo. */
export function logArgs(scope, limit) {
    const prefix = scope.repo === "." ? "" : `${scope.repo}/`;
    const specs = scope.paths.map((p) => (prefix && p.startsWith(prefix) ? p.slice(prefix.length) : p));
    return ["log", `-n${limit}`, "--format=%x01%H%x02%aI%x02%an%x02%s", "--name-only", ...(specs.length ? ["--", ...specs] : [])];
}
/**
 * One repo's log for a scope, off the extension host's thread. Nothing when git cannot answer (a repo
 * with no commits yet); a REJECTION only when the log overran `timeoutMs` and was killed, which the
 * feed reports as a repo it could not read.
 */
export function readLog(root, scope, limit, timeoutMs = ACTIVITY_GIT_TIMEOUT_MS) {
    const prefix = scope.repo === "." ? "" : `${scope.repo}/`;
    return new Promise((resolve, reject) => {
        execFile("git", logArgs(scope, limit), { cwd: path.join(root, scope.repo), timeout: timeoutMs, maxBuffer: 64 * 1024 * 1024 }, (err, out) => {
            if (err)
                return err.killed ? reject(err) : resolve([]);
            resolve(parseActivityLog(String(out), scope.repo).map((e) => ({ ...e, paths: e.paths.map((p) => `${prefix}${p}`) })));
        });
    });
}
function startRead(read) {
    const r = { state: "reading", entries: [], settled: Promise.resolve(), at: Date.now() };
    r.settled = (async () => {
        try {
            r.entries = await read();
            r.state = "done";
        }
        catch {
            r.state = "failed";
        }
        r.at = Date.now();
    })();
    return r;
}
/**
 * Several scopes' logs as ONE feed: merged newest first, a commit read from two overlapping scopes
 * once, one PAGE of it (`offset`, `limit`), each file named as a record where it is one (`recordOf`,
 * with its title) and each entry by its repo's name.
 *
 * Paging a merge needs no cursor: the page's entries are among the newest `offset + limit` of SOME
 * scope, so reading that many (and one more, to know whether an older page exists) from each scope
 * and cutting the merge is exact. A page deep in a long history re-reads the pages before it — git
 * walks those in milliseconds, and the page is the only thing named.
 *
 * THE SCOPES ARE READ CONCURRENTLY, and with `budgetMs` / `graceMs` the page need not wait for all of
 * them (operator 2026-10-31: "don't wait for everything to load"): it answers once every scope is in,
 * or once one more than `settled` (what the asker already has) is in and `graceMs` has passed, or at
 * `budgetMs` — naming the repos still `pending` and those `failed`. The reads live in `reads`, so the
 * asker's next request with `settled` JOINS them rather than starting over; a request without it
 * starts fresh. Exact once nothing is pending; until then it is the merge of the repos that answered.
 * Without a budget it waits for every scope. A follow-up handed the `previous` page gets that very
 * page back when nothing has settled since — merging and naming records is the host's real cost.
 */
export async function activityFeed(root, scopes, page, recordOf, opts = {}) {
    const { limit, offset, workspace, settled: known } = page;
    const read = opts.read ?? ((s, n) => readLog(root, s, n));
    const reads = opts.reads ?? new Map();
    for (const [key, r] of reads)
        if (r.state !== "reading" && Date.now() - r.at > ACTIVITY_READ_RETENTION_MS)
            reads.delete(key);
    const n = offset + limit + 1;
    const mine = scopes.map((scope) => {
        const key = `${scope.repo}\0${scope.paths.join("\0")}\0${n}`;
        let r = reads.get(key);
        if (!r || (known === undefined && r.state !== "reading"))
            reads.set(key, (r = startRead(() => read(scope, n))));
        return { scope, r };
    });
    const settledCount = () => mine.filter((m) => m.r.state !== "reading").length;
    if (settledCount() < mine.length) {
        await new Promise((resolve) => {
            let over = false;
            let grace;
            const budget = opts.budgetMs === undefined ? undefined : setTimeout(finish, opts.budgetMs);
            function finish() {
                over = true;
                clearTimeout(budget);
                clearTimeout(grace);
                resolve();
            }
            const check = () => {
                if (over)
                    return;
                const count = settledCount();
                if (count === mine.length)
                    return finish();
                if (opts.graceMs !== undefined && count > (known ?? 0) && !grace)
                    grace = setTimeout(finish, opts.graceMs);
            };
            for (const m of mine)
                void m.r.settled.then(check);
            check();
        });
    }
    if (known !== undefined && opts.previous?.settled === settledCount())
        return opts.previous;
    const seen = new Set();
    const all = mine
        .filter((m) => m.r.state === "done")
        .flatMap((m) => m.r.entries)
        .filter((e) => (seen.has(`${e.repo} ${e.sha}`) ? false : (seen.add(`${e.repo} ${e.sha}`), true)));
    all.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
    const entries = all.slice(offset, offset + limit).map(({ paths, ...e }) => {
        const records = [];
        const keys = new Set();
        for (const p of paths) {
            const r = recordOf(p);
            if (!r || keys.has(`${r.collection}/${r.id}`))
                continue;
            keys.add(`${r.collection}/${r.id}`);
            records.push(r);
        }
        return { ...e, source: repoName(e.repo, workspace), records, files: paths.length };
    });
    const named = (state) => [...new Set(mine.filter((m) => m.r.state === state).map((m) => repoName(m.scope.repo, workspace)))];
    return { entries, hasMore: all.length > offset + limit, pending: named("reading"), failed: named("failed"), settled: settledCount() };
}
