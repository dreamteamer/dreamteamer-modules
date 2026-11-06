import type { ModuleRecord } from "./fsdata.js";
import type { SourceStackEntry, SourcesContext } from "./sources.js";
export type Provider = "github" | "bitbucket";
export type Level = "none" | "read" | "write" | "admin";
/** What a remote names — never the alias it was reached through, never userinfo. */
export interface RemoteRef {
    provider: Provider;
    host: string;
    owner: string;
    repo: string;
}
export interface AccessTarget {
    /** The source's NAME, as the Sources section names it. */
    source: string;
    /** The push url (`git remote get-url --push origin`), when there is one. */
    url?: string;
    /** The git top-level the url was read in — where git's own ssh command is read for the greeting. */
    repoDir?: string;
    /** A word for the hover: "the workspace's remote" for an inline module. */
    note?: string;
    /** Why there is no url ("no remote", "not installed"). */
    reason?: string;
}
export interface OwnAccess {
    remote?: RemoteRef;
    state: "ok" | "no-login" | "no-access" | "unknown" | "not-checked";
    level?: Level;
    role?: string;
    account?: string;
    tiedToPushKey?: boolean;
    reason?: string;
    note?: string;
}
export interface Member {
    name: string;
    kind: "user" | "team" | "group";
    level: Level;
    role?: string;
    via?: string;
}
export interface Members {
    remote?: RemoteRef;
    state: "ok" | "partial" | "refused" | "no-login" | "no-access" | "unknown";
    members: Member[];
    account?: string;
    reason?: string;
}
/** What a host injects through `WorkspaceApi.useRemoteAccess`: the providers, as the account each remote
 *  pushes as. `heldSecrets` is every credential VALUE the host holds right now, for the redaction guard. */
export interface RemoteAccessProvider {
    own(targets: AccessTarget[], opts?: { fresh?: boolean }): Promise<Record<string, OwnAccess>>;
    members(target: AccessTarget): Promise<Members>;
    heldSecrets(): Promise<string[]>;
    forget?(): void;
}
export type Git = (args: string[], cwd: string) => string | undefined;
export declare function accessTargets(stack: { workspace: SourceStackEntry; layers: SourceStackEntry[]; modules: SourceStackEntry[] }, root: string, modules: Array<Pick<ModuleRecord, "id" | "path">>, gitModules: SourcesContext["gitModules"], git?: Git): AccessTarget[];
export declare const NOT_AVAILABLE: string;
export declare function unavailableAccess(targets: AccessTarget[]): { available: false; access: Record<string, OwnAccess> };
export declare function redactSecrets<T>(value: T, extra?: string[]): T;
