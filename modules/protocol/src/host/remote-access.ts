// REMOTE ACCESS, the host's half (cr-vscode-012, re-homed with cr-modules-005): which remote each Sources
// entry is checked against, and the redaction guard every answer passes. The PROVIDERS — who asks GitHub
// and Bitbucket, as the account the remote pushes as — are the host's own (the VS Code extension injects
// them through `WorkspaceApi.useRemoteAccess`); a host with none answers `not-checked` and says why.
import * as fs from "node:fs";
import * as path from "node:path";
import { execFileSync } from "node:child_process";

/** @typedef {(args: string[], cwd: string) => string | undefined} Git */
/** @type {Git} */
const realGit = (args, cwd) => {
    try {
        return execFileSync("git", args, { cwd, stdio: ["ignore", "pipe", "ignore"] }).toString().trim() || undefined;
    }
    catch {
        return undefined;
    }
};
function topLevel(dir, git) {
    let real;
    try {
        real = fs.realpathSync(dir);
    }
    catch {
        return undefined;
    }
    const top = git(["rev-parse", "--show-toplevel"], real);
    return top ? safeReal(top) : undefined;
}
function safeReal(p) {
    try {
        return fs.realpathSync(p);
    }
    catch {
        return p;
    }
}
/**
 * ONE RULE for every entry: take the entry's folder, resolve it, find its git top-level. The workspace's
 * own top-level → the workspace's push url (with a note for a module entry); any other top-level → that
 * repo's OWN push url, so a linked clone is never judged as the workspace. A layer folder that is not its
 * own clone falls back to its declared `git_modules` url. An installed package has no target; an
 * uninstalled layer, or a repo with no remote, has a target with no url.
 */
export function accessTargets(stack, root, modules, gitModules, git = realGit) {
    const wsTop = topLevel(root, git);
    const pushUrl = (top) => (top ? git(["remote", "get-url", "--push", "origin"], top) : undefined);
    const wsUrl = pushUrl(wsTop);
    const out = [];
    const at = (source, url, repoDir, extra = {}) => url ? { source, url, ...(repoDir ? { repoDir } : {}), ...extra } : { source, reason: extra.reason ?? "no remote", ...(extra.note ? { note: extra.note } : {}) };
    out.push(at(stack.workspace.name, wsUrl, wsTop));
    for (const l of stack.layers) {
        if (!l.installed) {
            out.push({ source: l.name, reason: "not installed" });
            continue;
        }
        const top = topLevel(path.join(root, l.repo), git);
        if (top && top !== wsTop)
            out.push(at(l.name, pushUrl(top), top));
        else
            out.push(at(l.name, gitModules[l.name]?.url, undefined));
    }
    for (const m of stack.modules) {
        if (m.via === "package")
            continue;
        const rec = modules.find((x) => x.id === m.name);
        const folder = path.join(root, rec?.path && rec.path !== "." ? rec.path : m.repo);
        const top = topLevel(folder, git);
        if (!top)
            out.push(at(m.name, undefined, undefined));
        else if (top === wsTop)
            out.push(at(m.name, wsUrl, wsTop, { note: "the workspace's remote" }));
        else
            out.push(at(m.name, pushUrl(top), top));
    }
    return out;
}
export const NOT_AVAILABLE = "remote access is not available in this host";
/** What a host with no provider answers `GET /sources/access`: every target not checked, and why. */
export function unavailableAccess(targets) {
    return { available: false, access: Object.fromEntries(targets.map((t) => [t.source, { state: "not-checked", reason: NOT_AVAILABLE }])) };
}
const TOKEN_SHAPES = [
    /\bgh[pousr]_[A-Za-z0-9]{36,}\b/g,
    /\bgithub_pat_[A-Za-z0-9_]{22,}\b/g,
    /\bATATT[A-Za-z0-9_\-=]{20,}/g,
    /\b(?:Basic|Bearer)\s+[A-Za-z0-9+/=._-]{16,}/g,
];
/**
 * Every string in `value` with each FULL token shape — and each exact value in `extra` (eight characters
 * or more) — replaced by `[redacted]`. Full shapes only, so a name a provider reports (`ghp_tools`,
 * `Basic Users`) reaches the screen as reported. The second line, never the first: a provider's text is
 * not forwarded in the first place.
 */
export function redactSecrets(value, extra = []) {
    const exact = extra.filter((s) => typeof s === "string" && s.length >= 8);
    const scrub = (s) => {
        let out = s;
        for (const e of exact)
            out = out.split(e).join("[redacted]");
        for (const re of TOKEN_SHAPES)
            out = out.replace(re, "[redacted]");
        return out;
    };
    const walk = (v) => {
        if (typeof v === "string")
            return scrub(v);
        if (Array.isArray(v))
            return v.map(walk);
        if (v && typeof v === "object")
            return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x)]));
        return v;
    };
    return walk(value);
}
