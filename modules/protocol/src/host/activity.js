// Ported from the dreamteamer VS Code extension's host side (src/activity.ts); PROTOCOL.md is the contract it answers.
import * as fs from "node:fs";
import * as path from "node:path";
import { execFile } from "node:child_process";
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
export function repoName(repo, workspace) {
    if (repo === ".")
        return workspace;
    const parts = repo.split("/");
    return parts[0] === "git_modules" && parts[1] ? parts[1] : parts[parts.length - 1];
}
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
export const ACTIVITY_PAGE = 20;
export const ACTIVITY_BUDGET_MS = 3000;
export const ACTIVITY_GRACE_MS = 150;
export const ACTIVITY_GIT_TIMEOUT_MS = 60_000;
export const ACTIVITY_READ_RETENTION_MS = 60_000;
export function logArgs(scope, limit) {
    const prefix = scope.repo === "." ? "" : `${scope.repo}/`;
    const specs = scope.paths.map((p) => (prefix && p.startsWith(prefix) ? p.slice(prefix.length) : p));
    return ["log", `-n${limit}`, "--format=%x01%H%x02%aI%x02%an%x02%s", "--name-only", ...(specs.length ? ["--", ...specs] : [])];
}
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
