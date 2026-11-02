// THE NAV AXIS — which folder a collection appears under in the left tree.
//
// Its own module for two reasons. It is a pure DECISION over descriptors, with no editor API in it,
// so keeping it out of `tree.ts` means it can be tested by running it (test/unit/namespace-ui.test.ts)
// rather than by booting a VS Code host — and `tree.ts` cannot be imported outside the editor at all,
// because its TreeItem subclasses use TypeScript parameter properties, which Node's type stripping
// refuses. The second reason is the first reason's consequence: a decision worth arguing about should
// live somewhere a test can reach it.
import { engine } from "./engine.js";
import { isInternal, isRuntime } from "./fsdata.js";
import { describeSources } from "./sources.js";
/**
 * A runtime-stored collection this workspace keeps records in ON PURPOSE, and therefore a nav row.
 *
 * ⚠ THE OVERLAY IS THE OPT-IN, and that is the whole mechanism — there is no separate flag. Compile
 * derives `compiled.overlaid_by` (the modules contributing an overlay to a collection, asked through
 * `overlaidByOf`), so a runtime collection carrying one has been deliberately extended by a module in
 * this tree. Nobody does that by accident: the overlay gate refuses an overlay whose base module is
 * not declared in `dreamteamer.dependencies`, so it costs an authored dependency and an authored
 * descriptor. An operator who paid that has said the collection is theirs.
 *
 * Why this rather than a `nav: true` on the descriptor: that field would cost an engine field, an
 * engine release and a version bump in every consumer, and `overlaid_by` is already derived and already
 * means "somebody in this tree claimed this".
 *
 * The default is untouched: `collections`, `skills`, `commands`, `command-bindings`, `ui-views`,
 * `mixins`, `modules` and any runtime kind an engine extension contributes carry no overlay in an
 * ordinary workspace and stay where they belong, in the Schema tab.
 */
export function keepsRuntimeRecords(d) {
    return engine().descriptor.overlaidByOf(d).length > 0;
}
/**
 * Does this collection fold OUT of the record tree and live on the Schema tab instead?
 *
 * Exported and pure so it can be asserted by running it. It was inline in the descriptor loop
 * below, where the only way to check it was to boot an editor — and it is exactly the decision
 * worth arguing about, which this module's header says is the reason the module exists.
 */
export function shouldFoldOutOfRecordTree(d) {
    return isInternal(d) && !keepsRuntimeRecords(d);
}
/**
 * Where a collection BROWSES in the app. The workspace's plumbing (`internal: true`) routes under
 * `/settings/system/*`, where the app has modelled the schema since the settings app existed
 * (webview/src/registry/register-defaults.ts); everything else is content.
 *
 * ⚠ It asks `isInternal`, not `isRuntime`. Those agree on every engine kind except `repos` — internal
 * while its records are ordinary files the operator edits. `isRuntime` is the WRITE question (what the
 * compiler stamps and what the store's own refusal reads); routing by it sent `repos` to `/content/*`
 * while the schema surface expected it. Never answer one of these two from the other.
 *
 * ⚠ `collections` used to be special-cased to `/settings/data-model` here, and that one line is
 * why the schema diagram had no route a user could reach: `collections` is a collection, its
 * records are descriptors, and a diagram over it is an ordinary saved view.
 */
export function routeFor(d) {
    return isInternal(d) ? `/settings/system/${d.name}` : `/content/${d.name}`;
}
/**
 * What a collection's own ROW in the tree says: the title compile resolved (`titleOf` — authored, or
 * `compiled.defaults.title`; the tree never title-cases an id itself), the descriptor's
 * `display.nav.icon`, and its records root as the tooltip. Pure, so it is asserted by running it —
 * `tree.ts` cannot be imported outside an editor.
 *
 * With `sources` (0.24.0, `src/sources.ts`): a row a layer or a module actually holds records of is
 * `shared`, and the tree marks it with a monochrome `⚭` beside the title; a private row carries no
 * mark (operator 2026-10-29 — the dimmed `from org` there read as part of the name, and the question
 * a row answers is shared-or-not, not which source). The hover says where the shared records come
 * from (`from org`, `from 3 layers`, `project-a not installed`) above every root with its count. The
 * workspace's own root is never counted, so a collection with no layer and no module-owned list reads
 * exactly as it did.
 */
export function collectionRow(d, sources) {
    const { titleOf, displayOf, storageOf } = engine().descriptor;
    // THE RECORD COUNT, on EVERY collection row wherever the nav puts it (operator 2026-10-30) — the
    // tree draws it as the row's description, dimmed. It is the browse page's total: the sum over every
    // root of the ids each root is the FIRST to claim (`sources.ts#countsByRoot`), so an id two roots
    // hold counts once, exactly as `dt list` reads it. No walk of its own — the counts ride on `sources`.
    const count = sources ? sources.reduce((n, s) => n + (s.installed ? s.count : 0), 0) : undefined;
    const row = { label: titleOf(d), icon: displayOf(d).nav?.icon, tooltip: storageOf(d).path, ...(count !== undefined ? { count } : {}) };
    if (!sources?.some((s) => s.kind !== "own"))
        return row;
    const { description, detail } = describeSources(sources);
    const shared = sources.some((s) => s.kind !== "own" && s.count > 0);
    const head = shared ? `Shared · ${description}` : description;
    const tooltip = [...(head ? [head] : []), storageOf(d).path, "", ...detail].join("\n");
    return { ...row, tooltip, ...(shared ? { shared: true } : {}) };
}
/**
 * THE MODULE A NAV FOLDER IS — what a click on it opens: that module's page in the Schema tab, the
 * same page Settings › Schema › Modules shows (operator 2026-10-29). A module fold (`mod:<id>`) is the
 * module itself; a namespace folder (`ns:<ns>`) is the module that declares the namespace; a record
 * layer is the module of the same id where it attaches as one (`git_modules.<key>.module: true`, so
 * `.dreamteamer/modules/<key>.module.yaml` exists); a SECTION (`grp:`, a `display.nav.section` or a
 * `dreamteamer.navGroups` entry) is the module whose collections it holds EXACTLY — every one it ships
 * and nothing else, as a `crm` section over the CRM module's three is (operator 2026-10-29). A section
 * holding part of a module (Meetings out of a larger one) or several modules' is none. The workspace
 * row is no one module — it opens them all — and a folder that is no module — a workspace group, a plain layer — answers undefined and only expands.
 */
export function folderModule(folder, modules) {
    const has = (id) => (id && modules.some((m) => m.id === id) ? id : undefined);
    if ("layer" in folder)
        return has(folder.layer);
    if (folder.key.startsWith("mod:"))
        return has(folder.key.slice(4));
    if (folder.key.startsWith("ns:")) {
        const ns = folder.key.slice(3);
        return modules.find((m) => m.namespaces?.includes(ns))?.id;
    }
    if (folder.key.startsWith("grp:")) {
        const held = new Set((folder.collections ?? []).map((d) => d.name));
        if (!held.size)
            return undefined;
        return modules.find((m) => {
            const ships = (m.collections ?? []).map((c) => c.replace(/^collections\//, ""));
            return ships.length === held.size && ships.every((c) => held.has(c));
        })?.id;
    }
    return undefined;
}
/**
 * HOW A NAV FOLDER DRAWS, AND WHAT ITS CLICK DOES — one rule for every folder kind (a module fold, a
 * namespace, a section, a record layer), so a module looks and behaves the same wherever the nav puts
 * it (operator 2026-10-29). A folder that IS a module (`folderModule`) opens the module's page,
 * narrowed to it, and wears an icon that says what it DOES — the icon of the first collection it ships
 * (`moduleIcon`), the Schema tab's generic module icon only when it ships none. That it is a module at
 * all is said on the right, by the module mark where the shared mark sits on other rows (`rowMarks`) —
 * operator, same day: "module icons should reflect functionality, move module indicator next to shared
 * indicator", then "simple single icon".
 * Any other folder is a plain folder that only opens and closes — a records-only layer, a mixed
 * section, a workspace group — and carries the shared mark when what it holds is shared.
 */
export const MODULE_ICON = "deployed_code";
/** A plain folder. NOT the codicon `folder`: VS Code draws that one from the file-icon theme the moment
 *  the row carries a `resourceUri` — which a marked row does — and most themes draw nothing there. */
export const PLAIN_FOLDER_ICON = "folder-compact";
/** The mark on the right of a row — ONE, never two (operator 2026-10-29: "too much noise on module
 *  indicator, simple single icon", then "very small dot, solid"). Text, because a tree badge is text
 *  on the stable API — a codicon badge is gated behind the `codiconDecoration` proposal, which only
 *  allow-listed extensions get — and monochrome: no decoration colour, which would tint the label too. */
export const MODULE_MARK = "•";
export const SHARED_MARK = "⚭";
/** A row's badge: the module mark for a module (what it is outranks where its records come from), else
 *  the shared mark for anything shared; undefined when it is neither. */
export function rowMarks(marks) {
    return marks.module ? MODULE_MARK : marks.shared ? SHARED_MARK : undefined;
}
/**
 * What a module DOES, as an icon: the nav icon of its LEADING collection — the one it ships that the
 * nav puts first (lowest `display.nav.order`, unordered last, ties in the module's own order). A
 * schema kind it overlays (`agents`) is plumbing, not its function, and is skipped.
 */
export function moduleIcon(module, look) {
    const shipped = (module?.collections ?? [])
        .map((ref, i) => ({ i, ...(look(ref.replace(/^collections\//, "")) ?? {}) }))
        .filter((c) => c.icon && !c.runtime)
        .sort((a, b) => (a.order ?? Infinity) - (b.order ?? Infinity) || a.i - b.i);
    return shipped[0]?.icon;
}
export function folderPresentation(module, about, 
/** `source`: the record layer this folder is drawn INSIDE — its click opens the module's page scoped to it. */
opts = {}) {
    const marks = rowMarks({ module: Boolean(module), shared: opts.shared });
    if (!module)
        return { icon: PLAIN_FOLDER_ICON, ...(about ? { tooltip: about } : {}), ...(marks ? { marks } : {}) };
    return { icon: opts.icon ?? MODULE_ICON, tooltip: `${about ? `${about} — ` : ""}module ${module}${opts.source ? ` · ${opts.source}'s records` : ""} · click for its page`, route: moduleRoute(module, opts.source), ...(marks ? { marks } : {}) };
}
/** The workspace row's page: the Activity of EVERY module, aggregated, never narrowed — the root is all
 *  of them (operator 2026-10-29: "root nav node should show aggregated"). */
export const WORKSPACE_ROUTE = "/settings/schema/activity";
/** Where a module clicked in the nav lands: the Schema tab's ACTIVITY page — its named git history,
 *  the first page, or the module's PAGE view when one names it (`webview/src/pages/ModulePage.vue`) —
 *  with the tab narrowed to that module (`webview/src/lib/module-scope.ts`). Its record is one click
 *  away, under Modules. `source`: the folder sits inside that record layer, so the page is scoped to
 *  the layer's records (cr: nested ui-views). */
export function moduleRoute(id, source) {
    return `/settings/schema/activity?module=${encodeURIComponent(id)}${source ? `&source=${encodeURIComponent(source)}` : ""}`;
}
/**
 * THE NAV AXIS: namespace first, and — for the DEFAULT namespace only — the owning module second.
 * The decision, separated from the tree widgets so it can be tested without a VS Code window
 * (test/unit/namespace-ui.test.ts).
 *
 * It used to be `owner` (a module) alone, and that was right while a workspace's only partition was
 * "which module shipped this". Namespaces gave the operator a partition of their own — health, finance,
 * work — and letting both compete for ONE fold was the mistake `group:` made before `owner` replaced
 * it: one screen, two spellings of "what this belongs to". So the module fold was removed outright.
 *
 * ⚠ **And then it came back, NARROWED (2026-09-10).** Five meeting-family collections — meetings,
 * preps, summaries, analyses, recordings — drew as five sibling top-level rows in a workspace that keeps
 * them all in the default namespace, and the operator asked for one Meetings folder. The namespace axis
 * cannot give him that without renaming every id and every reference; the module that OWNS the family
 * can, at no migration cost. The two axes never see the same COLLECTION — but they can see the same
 * MODULE, and so the same FOLDER; the fourth bullet is what keeps that one folder:
 *
 *  - A NAMESPACED collection folds under `ns:<namespace>`, whoever owns it. Nested namespaces nest.
 *  - A DEFAULT-namespace collection folds under `mod:<owner>` when that module owns TWO OR MORE
 *    default-namespace collections here — a folder of one costs a click and shows nothing the row did
 *    not — and is NOT the workspace module. Otherwise it lists ungrouped at the top, as before.
 *  - ⚠ EXCEPT when that module owns too few and DEPENDS on one that folds, in which case its
 *    collections file under the DEPENDENCY's folder (2026-09-10, the operator's second ask: "meeting
 *    recordings should also move under meetings module"). A module that owns one collection here and
 *    declares a hard dependency on the module owning the family is an EXTENSION of it — the audio and
 *    transcript of a meeting are part of the meeting family however the modules are packaged — and the
 *    two honest alternatives are both worse: a sibling row above the folder its own family is in, or a
 *    folder of one. ONE HOP ONLY, and only when the dependency ACTUALLY FOLDS here: chasing a chain
 *    would drag a collection into a folder named after a module its own package.json never names, and
 *    a dependency owning one collection here would invent a folder for two rows that are not a family.
 *    The graph is the compiled module record's `dependencies` (`.dreamteamer/modules/<id>.module.yaml`),
 *    which is authored as `dreamteamer.dependencies` and is the same list the extends gate charges for.
 *  - ⚠ ONE MODULE, ONE FOLDER (2026-10-30). A module that DECLARES a namespace and also owns default-
 *    namespace collections folds those into its namespace's folder, not a `mod:` folder of its own. The
 *    rule above used to draw both — `mod:<id>` for the default-namespace pair and `ns:<namespace>` for
 *    the rest — and when the namespace is named after the module, both borrow the module's title: two
 *    sibling folders with one label, the module's family split across them for no reason anyone
 *    authored. The namespace folder keeps its key, its place and its title; the fold condition is
 *    unchanged (two or more, or a dependent riding in), so a module owning ONE default-namespace
 *    collection still lists it at the top. The dependency hop follows the fold: a dependent filed under
 *    a module that folded into its namespace lands in that namespace's folder. Which namespace is the
 *    module's HOME is pinned by `homeNamespaceOf`: the one named after the module if it declares one
 *    (the case where the label collides), else its only ROOT namespace (a nested one it also declares
 *    hangs inside that root anyway); a module with several unrelated roots keeps its `mod:` folder,
 *    because picking among them would depend on the order the namespaces were typed into package.json,
 *    the trap the longest-prefix sort below exists to avoid. Only namespaces the WORKSPACE declares
 *    count, and with no module→namespaces map handed in the rule is off — the next bullet still holds.
 *  - ⚠ NEVER TWO SIBLING FOLDERS WITH ONE LABEL (2026-10-30, `foldSameLabel`). The bullet above keys
 *    the merge on what a module DECLARES, and two pictures slip past it: a section authored with a
 *    namespace's name (`display.nav.section: rnd` on a workspace collection draws `grp:rnd`, and its
 *    label borrows the rnd module's title exactly as `ns:rnd`'s does — two "R&D" folders), and a
 *    module whose namespaces this runtime cannot read, or which has several unrelated roots one of
 *    which carries its name. So the LABEL is the last word: after every fold, siblings that would draw
 *    the same label (`groupLabel`, case-insensitive) become ONE folder — the namespace's when one of
 *    them is a namespace, else the module's, else the section's — holding all their collections and
 *    children, keyed and placed as that folder. Same level only: a folder nested elsewhere with the
 *    same name is a different place. The same pass runs inside a layer's folder (`layerEntries`).
 *  - ⚠ THE WORKSPACE MODULE NEVER FOLDS. It is the operator's own catch-all — in a dogfood vault it owns
 *    every default-namespace collection — and folding it would put the whole vault under one folder
 *    named after itself, which is worse than flat. Which module that is comes from `package.json`
 *    (`workspaceModule` in fsdata.ts), and when it is UNKNOWN the module fold is off entirely: an
 *    older runtime, or a workspace that declares none, looks exactly as it did.
 *
 * ⚠ AND AN INTERNAL COLLECTION IS NOT A NAV NODE — unless this workspace overlaid it
 * (`keepsRuntimeRecords`, above), in which case it is a TOP-LEVEL row and never folds by module: the
 * engine owns every runtime kind, and sweeping `agents` under a System folder because `commands` was
 * overlaid too would undo the 0.15.1 opt-in. `collections`, `skills`, `agents`, `commands`,
 * `command-bindings`, `ui-views`, `mixins`, `modules` and `repos` are the SCHEMA of the workspace
 * by default, and the schema is a place you go (the Schema tab), not a group inside the place you keep
 * records.
 *
 * ⚠ **A NESTED namespace nests in the tree too** (2026-08-28). `family`, `family/health` and
 * `family/travel` are three declared namespaces and used to draw three SIBLING folders — "Family",
 * "Family Health", "Family Travel" — which reads as three unrelated partitions and buries the
 * relationship the names are spelling out. A namespace folder now hangs under the longest DECLARED
 * namespace that is a proper prefix of it, so Health and Travel sit inside Family, labelled by the
 * segment they add rather than by their whole path.
 *
 * Only a DECLARED prefix nests. `work/clients` under an undeclared `work` stays top-level: an
 * undeclared prefix is not a namespace, and inventing a folder for one would put a partition on screen
 * that the workspace never declared — the same "two spellings" mistake from the other direction.
 *
 * Folders sort by key, so module folders (`mod:`) come before namespace folders (`ns:`), each group
 * alphabetical.
 */
export function groupTopLevel(descriptors, declared, workspaceModule, dependsOn, navGroups, namespacesOf, titleOf = new Map()) {
    // LONGEST declared prefix wins, and we sort for it rather than trusting the order we were handed.
    // The engine's manifest happens to emit longest-first today, so a `find` over the given order was
    // right by luck; `dreamteamer.namespaces` in a package.json is authored in whatever order the
    // operator typed it, and there `family` before `family/health` would file every health collection
    // under Family with no error anywhere.
    const byLength = [...declared].sort((a, b) => b.length - a.length);
    const namespaceOf = (name) => byLength.find((ns) => name.startsWith(ns + "/")) ?? "";
    // The module a default-namespace collection MAY fold under: its owner (`compiled.module`, a bare
    // id), unless that is the workspace module or the fold is off (workspace module unknown).
    const foldModuleOf = (d) => {
        if (!workspaceModule || namespaceOf(d.name))
            return undefined;
        // An OVERLAID runtime kind belongs, for the nav, to the module that overlaid it (2026-10-28):
        // a module that extends `agents` and ships `people` means them as siblings in its own folder,
        // not an engine row at the top. The engine's own module never folds, so an un-overlaid runtime
        // kind still answers nothing here — and `shouldFoldOutOfRecordTree` has already kept it out.
        const id = isRuntime(d) ? engine().descriptor.overlaidByOf(d)[0] : engine().descriptor.moduleOf(d);
        return id && id !== workspaceModule ? id : undefined;
    };
    const perModule = new Map();
    for (const d of descriptors) {
        const id = foldModuleOf(d);
        if (id)
            perModule.set(id, (perModule.get(id) ?? 0) + 1);
    }
    // Which module's folder a foldable collection actually lands in. Its owner when that owner folds on
    // its own; otherwise the first module it DEPENDS on that folds here — one hop, never a chain, so the
    // folder a collection lands in is always readable off the package.json in front of you. `folds` is
    // the count test and nothing else, which is what keeps "only when the dependency folder exists"
    // honest: the workspace module and every runtime kind are already out of `perModule`, and a
    // dependency's own count is its OWN collections, so files arriving from a dependent never make a
    // second module foldable.
    const folds = (id) => (perModule.get(id) ?? 0) >= 2;
    const hostModuleOf = (id) => {
        if (folds(id))
            return id;
        for (const ref of dependsOn?.get(id) ?? []) {
            const dep = ref.replace(/^modules\//, "");
            if (dep !== id && folds(dep))
                return dep;
        }
        return undefined;
    };
    // ⚠ THE THIRD AXIS, AND IT IS THE WORKSPACE'S, NOT A MODULE'S (2026-09-11). The module fold puts
    // each family in its own folder, which is right until a workspace thinks of two families as one
    // place — the operator's "office" holding contacts AND meetings. Neither existing axis can say
    // that: namespacing renames every id, and merging the modules in the shared package would break
    // `disable` cherry-picking and every consumer's declared dependency on `meetings`.
    //
    // So a nav group is authored by the WORKSPACE (`dreamteamer.navGroups` in .vscode/settings.json),
    // which is the honest owner: it is a presentation choice about this screen, it must not cost an
    // engine field, an engine release and a version bump in every consumer (the same cost that made
    // `keepsRuntimeRecords` reuse `overlays` instead of a `nav:` flag), and one workspace grouping
    // its modules must not reorganise anybody else's.
    //
    // It OVERRIDES the module axis and nothing else: a namespaced collection still folds by
    // namespace, and a runtime-stored one is still not a nav node. A grouped module folds even when
    // it owns ONE collection here — naming it in the group IS the opt-in the count test stands in
    // for elsewhere. The dependency hop runs FIRST, so grouping `meetings` carries `recordings` in
    // with it without the workspace having to know that recordings is packaged separately.
    const groupOfModule = new Map();
    for (const [key, ids] of navGroups ?? [])
        for (const id of ids)
            groupOfModule.set(id, key);
    // The namespace a folding module's default-namespace collections join instead of a `mod:` folder —
    // ONE MODULE, ONE FOLDER (see the axis comment): the namespace named after the module, else its only
    // root namespace, else none (several unrelated roots keep the module folder).
    const homeNamespaceOf = (id) => {
        const own = (namespacesOf?.get(id) ?? []).filter((ns) => declared.includes(ns));
        if (own.includes(id))
            return id;
        const roots = own.filter((ns) => !own.some((o) => ns.startsWith(o + "/")));
        return roots.length === 1 ? roots[0] : undefined;
    };
    /** The folder key a foldable collection lands in, group first, else the folder of the module that
     *  hosts it — that module's home namespace when it declares one, its own `mod:` folder otherwise. */
    const folderKeyOf = (mod) => {
        const host = hostModuleOf(mod);
        const group = groupOfModule.get(mod) ?? (host ? groupOfModule.get(host) : undefined);
        if (group)
            return `grp:${group}`;
        if (!host)
            return undefined;
        const home = homeNamespaceOf(host);
        return home ? `ns:${home}` : `mod:${host}`;
    };
    const top = [];
    const byKey = new Map();
    const folder = (key) => {
        let f = byKey.get(key);
        if (!f)
            byKey.set(key, (f = { key, collections: [], children: [] }));
        return f;
    };
    for (const d of descriptors) {
        // The schema lives in its own tab. Not a nav node, and not a top-level row either — dropping it
        // into `top` would bury the operator's own collections under the engine's plumbing.
        //
        // ⚠ UNLESS THIS WORKSPACE OVERLAID IT. `agents` is the case that asked for the exception: a
        // workspace that dispatches agents as part of its actual work OPERATES them, they are not
        // plumbing to it, and they were reachable only through the Schema tab. An `extends:` on a
        // runtime collection is the opt-in (see `keepsRuntimeRecords`), so the row appears for the
        // workspace that asked and nowhere else.
        if (shouldFoldOutOfRecordTree(d))
            continue;
        // A descriptor's authored presentation wins over inferred namespace/module folders.
        // Overlays can set this without renaming the collection or moving its records.
        // Keep the internal-schema visibility gate above: a section does not expose hidden schema.
        const section = engine().descriptor.displayOf(d).nav?.section;
        if (typeof section === "string" && section.trim()) {
            folder(`grp:${section.trim()}`).collections.push(d);
            continue;
        }
        const ns = namespaceOf(d.name);
        if (ns) {
            folder(`ns:${ns}`).collections.push(d);
            continue;
        }
        const mod = foldModuleOf(d);
        const key = mod ? folderKeyOf(mod) : undefined;
        if (key) {
            folder(key).collections.push(d);
            continue;
        }
        top.push(d);
    }
    // A parent namespace that holds no collection of its own is still a folder — `family` could declare
    // nothing directly and exist purely to hold Health and Travel, and the fold would be wrong without it.
    for (const key of [...byKey.keys()]) {
        if (!key.startsWith("ns:"))
            continue;
        for (let parent = namespaceOf(key.slice(3)); parent; parent = namespaceOf(parent))
            folder(`ns:${parent}`);
    }
    // ⚠ A SECTION WHOSE ROWS ALL BELONG TO ONE FOLDING MODULE NESTS UNDER THAT MODULE (2026-10-28). A
    // module that ships twelve collections and sections four of them as "Settings" means a folder
    // INSIDE its own, not a sibling of it: the operator's ask was "meetings and settings show under
    // the module's node". The section's home is the folder its collections would have folded into
    // without the section — an overlaid runtime kind counts as the module that overlaid it — and it
    // nests only when every row agrees and that folder actually exists. A section the workspace
    // module authored, or one mixing modules, stays top-level exactly as before.
    // Only a MODULE's folder is a home — its `mod:` folder, or the `ns:` folder it folds into (one module,
    // one folder): a workspace nav group is the operator's own regrouping, and an authored section wins
    // over it rather than nesting inside it.
    const sectionParent = new Map();
    for (const [key, f] of byKey) {
        if (!key.startsWith("grp:"))
            continue;
        const homes = new Set();
        for (const d of f.collections) {
            const owner = foldModuleOf(d);
            homes.add(owner ? folderKeyOf(owner) : undefined);
        }
        const [home] = homes;
        if (homes.size === 1 && (home?.startsWith("mod:") || home?.startsWith("ns:")) && byKey.has(home))
            sectionParent.set(key, home);
    }
    // Alphabetical by key: `mod:` folders first, then `ns:`. The `mod:dreamteamer`-sinks-to-the-bottom
    // special case of the old module fold is not back — the engine's module never folds here at all.
    const sorted = [...byKey.values()].sort((a, b) => a.key.localeCompare(b.key));
    const roots = [];
    for (const f of sorted) {
        const parent = f.key.startsWith("ns:") ? namespaceOf(f.key.slice(3)) : "";
        if (parent)
            byKey.get(`ns:${parent}`).children.push(f);
        else if (sectionParent.has(f.key))
            byKey.get(sectionParent.get(f.key)).children.push(f);
        else
            roots.push(f);
    }
    return { top, folders: foldSameLabel(roots, titleOf) };
}
/** Which of several same-label siblings survives: a namespace, then a module fold, then a section. */
const FOLD_RANK = ["ns:", "mod:", "grp:"];
const foldRank = (key) => {
    const i = FOLD_RANK.findIndex((p) => key.startsWith(p));
    return i < 0 ? FOLD_RANK.length : i;
};
/**
 * NEVER TWO SIBLING FOLDERS WITH ONE LABEL (see the axis comment on `groupTopLevel`). Siblings whose
 * `groupLabel` matches, ignoring case, become one folder: the highest-ranked (`FOLD_RANK`, then key)
 * keeps its key and place, and takes the others' collections after its own and their children among
 * its own, sorted by key as every level is. Recurses with each folder as the parent, so a nested level
 * is labelled — and merged — exactly as the tree labels it. Mutates nothing it was handed.
 */
export function foldSameLabel(folders, titleOf, parentKey) {
    const labelOf = (f) => groupLabel(f.key, titleOf, parentKey).trim().toLowerCase();
    const byLabel = new Map();
    for (const f of folders)
        byLabel.set(labelOf(f), [...(byLabel.get(labelOf(f)) ?? []), f]);
    const out = [];
    for (const f of folders) {
        const [keep, ...rest] = [...byLabel.get(labelOf(f))].sort((a, b) => foldRank(a.key) - foldRank(b.key) || a.key.localeCompare(b.key));
        if (keep !== f)
            continue; // drawn inside the survivor, at the survivor's place
        const children = rest.length ? [...keep.children, ...rest.flatMap((r) => r.children)].sort((a, b) => a.key.localeCompare(b.key)) : keep.children;
        out.push({
            key: keep.key,
            collections: rest.length ? [...keep.collections, ...rest.flatMap((r) => r.collections)] : keep.collections,
            children: foldSameLabel(children, titleOf, keep.key),
        });
    }
    return out;
}
/**
 * The name a workspace uses to talk about a top-level entry — a collection's own name, or a folder's
 * key with its axis prefix removed. So `dreamteamer.navOrder` is written the way the operator says
 * it out loud (`["users", "agents", "projects", "office", "rnd"]`) and never has to know which of
 * those is a namespace, which is a module fold and which is a workspace group.
 */
export const navKey = (e) => e.kind === "collection" ? e.descriptor.name : e.kind === "layers" ? e.label.toLowerCase() : e.folder.key.replace(/^(?:ns|mod|grp):/, "");
/** `dreamteamer.navHidden` as the nav reads it: the non-blank strings, trimmed and lower-cased; `[]`
 *  for anything that is not a list. */
export function navHiddenOf(raw) {
    if (!Array.isArray(raw))
        return [];
    return raw.filter((n) => typeof n === "string" && n.trim() !== "").map((n) => n.trim().toLowerCase());
}
/**
 * THE TOP-LEVEL ENTRIES A WORKSPACE DOES NOT DRAW — `dreamteamer.navHidden` (operator 2026-11-01: a
 * project's domain namespaces, read for its records, drew two confusing roots beside the organisation
 * folder that already holds the project). Named the way `navOrder` names an entry (`navKey`), but
 * trimmed and case-insensitive. TOP LEVEL ONLY: it filters `orderTopLevel`'s sequence, so a folder
 * nested elsewhere and a layer folder's own nav (`layerEntries`) still draw what it hides, and nothing
 * is unread — lists, search and references never ask the nav. Nothing named returns `entries` itself.
 */
export function withoutHidden(entries, hidden) {
    if (!hidden?.length)
        return entries;
    const names = new Set(hidden.map((n) => n.trim().toLowerCase()));
    return entries.filter((e) => !names.has(navKey(e).toLowerCase()));
}
/**
 * THE TOP-LEVEL ORDER — rows and folders in ONE sequence.
 *
 * ⚠ WITHOUT `navOrder` THIS CHANGES NOTHING: every collection row first (already sorted by the
 * descriptors' `display.nav.order`), then every folder, exactly as the tree drew them before. That default is
 * deliberate — interleaving folders by, say, the lowest `order` they contain would silently
 * reshuffle the nav of every workspace that never asked, to fix one that did.
 *
 * WITH `navOrder`, the names it lists are placed in that order and everything else keeps its
 * existing relative position behind them. It is a workspace's explicit override of the TOP LEVEL
 * only: inside a folder, and among the entries it does not name, the descriptors' `display.nav.order`
 * still decides. One spelling per question — `display.nav.order` says where a collection sits among its siblings,
 * `navOrder` says what the ten things on the left are, top to bottom.
 *
 * An unknown name is ignored rather than refused: a workspace that disables a module should not
 * have to edit its nav order too, and a typo costs a row in the wrong place, not a broken tree.
 *
 * A collection the list names that sits INSIDE a folder is lifted out of it first (see below), so
 * `navOrder` is also the per-collection opt-out the module fold never had.
 */
export function orderTopLevel(top, folders, navOrder, layers) {
    // The record layers' folders (see `layerGroups`) come LAST by default — after every folder, so a
    // workspace that gains a layer keeps its nav as it was and finds one more folder at the bottom.
    const tail = !layers ? [] : Array.isArray(layers) ? layers : [layers];
    if (!navOrder?.length) {
        return [
            ...top.map((d) => ({ kind: "collection", descriptor: d })),
            ...folders.map((f) => ({ kind: "folder", folder: f })),
            ...tail,
        ];
    }
    // ⚠ A COLLECTION NAMED IN navOrder LEAVES ITS FOLDER (2026-10-28). The module fold has no
    // per-collection opt-out, so a template that wants `tasks` at the top above the workspace's own
    // `notes` had no way to say it: `navOrder` ranked only what was already top-level, and a name
    // inside a folder was silently ignored. Naming a collection IS the opt-out — it is lifted out of
    // its `mod:` / `grp:` / `ns:` folder and ranked at the top with everything else the list names;
    // an unnamed collection keeps today's fold. A folder emptied by the lift, with nothing nested
    // in it, is dropped rather than drawn as an empty row. The input folders are never mutated — the
    // tree rebuilds them on every refresh, and a test reuses them.
    // A name that is also a FOLDER's — `meetings` naming the Meetings section that holds the
    // `meetings` collection — means the folder: lifting a collection out of the folder that carries
    // its own name is nobody's intent, and the folder is what the operator sees to say out loud.
    const folderNames = new Set();
    const collect = (f) => {
        folderNames.add(navKey({ kind: "folder", folder: f }));
        f.children.forEach(collect);
    };
    folders.forEach(collect);
    // the layers' folder is a folder too: `projects` naming a layers folder labelled Projects means
    // the folder, exactly as `meetings` naming the Meetings section does
    for (const e of tail)
        folderNames.add(navKey(e));
    const named = new Set(navOrder.filter((n) => !folderNames.has(n)));
    const lifted = [];
    const prune = (f) => {
        const keep = [];
        for (const d of f.collections)
            (named.has(d.name) ? lifted : keep).push(d);
        const children = f.children.map(prune).filter((c) => c !== null);
        const untouched = keep.length === f.collections.length && children.length === f.children.length && children.every((c, i) => c === f.children[i]);
        if (untouched)
            return f;
        // only a folder the LIFT emptied is dropped — one that was empty to begin with is the
        // caller's to draw or not, exactly as before
        return keep.length || children.length ? { key: f.key, collections: keep, children } : null;
    };
    const remaining = folders.map(prune).filter((f) => f !== null);
    const entries = [
        ...top.map((d) => ({ kind: "collection", descriptor: d })),
        ...lifted.map((d) => ({ kind: "collection", descriptor: d })),
        ...remaining.map((f) => ({ kind: "folder", folder: f })),
        ...tail,
    ];
    const rank = new Map(navOrder.map((n, i) => [n, i]));
    // Stable: the fallback keeps an unlisted entry where it already was, so naming three things
    // moves three things.
    return entries
        .map((e, i) => ({ e, i, r: rank.get(navKey(e)) ?? Number.POSITIVE_INFINITY }))
        .sort((a, b) => a.r - b.r || a.i - b.i)
        .map(({ e }) => e);
}
/**
 * The label for a folder key: `ns:health` → "Health".
 *
 * ⚠ IT STILL READS THE MODULE TITLES, and that is not a leftover. A namespace whose name IS a module
 * id borrows that module's authored title — the only reason `rnd` renders as R&D rather than "Rnd",
 * because an acronym cannot be derived. That is a LABEL lookup, never a fold; removing the module
 * fold did not and must not take it with it. The `mod:` branch below is dead as a nav key and kept as
 * the label path for a module id handed in directly.
 *
 * `parentKey` is the folder this one is drawn INSIDE. A nested namespace is labelled by the segments it
 * adds — `ns:family/health` under `ns:family` is "Health", not "Family Health" — because the path is
 * already on screen as the row above it.
 *
 * ⚠ **A namespace whose name IS a module id borrows that module's authored title.** Title-casing gives
 * "Rnd" for a namespace the operator calls R&D, and an acronym cannot be derived — which is exactly why
 * a module carries a `title` at all. Where the two names coincide they are the same concept (a module
 * owns a namespace), so the authored title is the namespace's display name too. It stays a LABEL
 * lookup, never a fold: `owner` is not competing for the axis, and a namespace with no matching module
 * (`family/health`, or a namespace whose module is named differently) title-cases exactly as before.
 */
export function groupLabel(key, titleOf, parentKey) {
    if (key.startsWith("ns:")) {
        const ns = key.slice(3);
        const authored = titleOf.get(ns);
        if (authored)
            return authored;
        const parent = parentKey?.startsWith("ns:") ? parentKey.slice(3) : "";
        return moduleLabel(parent && ns.startsWith(parent + "/") ? ns.slice(parent.length + 1) : ns);
    }
    const id = key.slice(4);
    return moduleLabel(id, titleOf.get(id));
}
export function moduleLabel(id, title) {
    if (title)
        return title;
    return id
        .split(/[_\-\s/]+/)
        .filter(Boolean)
        .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
        .join(" ");
}
// ---- RECORD LAYERS — one folder per project a workspace reads -------------------------------------
//
// A record layer (engine 0.35.0) is another workspace cloned under `git_modules/<key>/` whose records a
// collection here reads below its own. The operator thinks of each one as a PROJECT he works in — a
// client's own records, kept in their own repo — so the nav draws one folder per layer, with a row per
// collection the layer actually holds records of, and a click opens that collection's browse filtered
// to `$source is <key>`: the same rule the 0.24.0 facet chip writes, so what the folder promises is
// what the table then says, and the filter is an ordinary, removable rule rather than a second mode.
//
// They nest inside a top-level folder (`dreamteamer.layersFolder`, "Layers" by default), which is a
// workspace's presentation choice and costs no engine field. Written as an OBJECT it draws several —
// `{ "Projects": ["org-project-*"], "Personal": ["hq-*"] }` — each holding the layers its patterns
// match (`layerGroups`). A workspace with no layer draws nothing here — `layerFolders` answers an
// empty list and the tree adds no folder.
/** The parent folder's label when the workspace sets none. */
export const LAYERS_FOLDER_DEFAULT = "Layers";
/** `dreamteamer.layersFolder` as the tree draws it: the setting trimmed, or "Layers" when it is unset,
 *  blank or not a string. */
export function layersFolderLabel(raw) {
    return typeof raw === "string" && raw.trim() ? raw.trim() : LAYERS_FOLDER_DEFAULT;
}
/** `*` matches any run of characters; everything else is literal. */
function keyMatches(pattern, key) {
    const re = pattern.split("*").map((p) => p.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join(".*");
    return new RegExp(`^${re}$`).test(key);
}
/**
 * `dreamteamer.layersFolder` resolved against the layer keys: which top-level folder each layer sits in.
 *
 * A string (or nothing) is the ONE folder every layer nests in, labelled by `layersFolderLabel`. An
 * object maps a folder label to the key patterns it holds (`*` wildcard; one string or a list), and
 * a layer joins the FIRST folder, in the object's order, whose pattern matches it — so a catch-all
 * can sit last. A layer no pattern matches still shows, in a "Layers" folder after the others: a
 * new layer must never vanish from the nav because a pattern was not updated. A folder no layer
 * matches is not drawn.
 */
export function layerGroups(raw, keys) {
    if (!keys.length)
        return [];
    if (!raw || typeof raw !== "object" || Array.isArray(raw))
        return [{ label: layersFolderLabel(raw), keys }];
    const groups = [];
    const rules = [];
    for (const [label, v] of Object.entries(raw)) {
        const patterns = (Array.isArray(v) ? v : [v]).filter((p) => typeof p === "string" && p.trim() !== "").map((p) => p.trim());
        if (!label.trim() || !patterns.length)
            continue;
        const group = { label: label.trim(), keys: [] };
        groups.push(group);
        rules.push({ group, patterns });
    }
    const rest = { label: LAYERS_FOLDER_DEFAULT, keys: [] };
    for (const k of keys)
        (rules.find((r) => r.patterns.some((p) => keyMatches(p, k)))?.group ?? rest).keys.push(k);
    return [...groups, rest].filter((g) => g.keys.length);
}
/**
 * The display label of every layer key: the longest dash-delimited prefix ALL the keys share is
 * stripped and each remaining segment title-cased — `org-project-alpha`, `org-project-beta-gamma` →
 * "Alpha", "Beta Gamma" — because a family of layers is named for the family first and the shared
 * words say nothing on a row that is already inside the family's folder. A single layer has no family
 * to strip and keeps its whole key. The prefix never eats a WHOLE key: `org-a` beside `org-a-b` strips
 * only `org`, so no label is ever empty.
 *
 * `titles` wins per key: a layer whose `package.json` authors `dreamteamer.title` or `title` is named
 * by it (`layerTitle` in sources.ts reads it), for the acronym a derivation cannot make.
 */
export function layerLabels(keys, titles) {
    const split = keys.map((k) => k.split("-"));
    let common = 0;
    if (keys.length > 1) {
        const shortest = Math.min(...split.map((s) => s.length));
        // leave at least one segment on every key
        while (common < shortest - 1 && split.every((s) => s[common] === split[0][common]))
            common++;
    }
    const out = new Map();
    keys.forEach((k, i) => out.set(k, titles?.get(k) || moduleLabel(split[i].slice(common).join("-"))));
    return out;
}
/** The browse route a layer row opens: the collection's own route, filtered to `$source is <layer>` —
 *  the builder's `{logic, rules}` shape that `?filter=` carries (`parseFilterGroup`). */
export function layerRoute(d, layer) {
    const filter = { logic: "_and", rules: [{ field: "$source", operator: "_eq", value: layer }] };
    return `${routeFor(d)}?filter=${encodeURIComponent(JSON.stringify(filter))}`;
}
/**
 * The layer folders, sorted by label: one per layer the stack names, each holding a row per
 * collection it has at least one record of, ordered as `descriptors` is (`loadDescriptors` sorts by
 * `display.nav.order`) and labelled with the collection's title and its count. A collection the
 * descriptors no longer carry is skipped rather than drawn as a dead row.
 */
export function layerFolders(layers, descriptors, titles) {
    if (!layers.length)
        return [];
    const { titleOf, displayOf } = engine().descriptor;
    const labels = layerLabels(layers.map((l) => l.name), titles);
    const position = new Map(descriptors.map((d, i) => [d.name, i]));
    const byName = new Map(descriptors.map((d) => [d.name, d]));
    return layers
        .map((l) => {
        const rows = l.installed
            ? l.collections
                .filter((c) => c.count > 0 && byName.has(c.collection))
                .sort((a, b) => position.get(a.collection) - position.get(b.collection))
                .map((c) => {
                const d = byName.get(c.collection);
                return { collection: c.collection, title: titleOf(d), icon: displayOf(d).nav?.icon, count: c.count, route: layerRoute(d, l.name) };
            })
            : [];
        return { key: l.name, label: labels.get(l.name), installed: l.installed, rows };
    })
        .sort((a, b) => a.label.localeCompare(b.label) || a.key.localeCompare(b.key));
}
/**
 * The top-level layers folders, each with its layer folders (`layerFolders` per group, so a label
 * strips the prefix shared WITHIN its folder — `hq-*` under Personal reads by person, `org-project-*`
 * under Projects by project).
 */
export function groupedLayerFolders(layers, descriptors, raw, titles) {
    return layerGroups(raw, layers.map((l) => l.name)).map((g) => ({
        label: g.label,
        layers: layerFolders(layers.filter((l) => g.keys.includes(l.name)), descriptors, titles),
    }));
}
/** The one dim row a layer's folder shows instead of collections: "not installed" for a declared
 *  layer whose clone is absent, "no records yet" for one holding nothing; undefined when it has rows. */
export function layerNote(l) {
    if (!l.installed)
        return "not installed";
    return l.rows.length ? undefined : "no records yet";
}
export function layerEntries(rows, descriptors, nav) {
    const rowOf = new Map(rows.map((r) => [r.collection, r]));
    const held = descriptors.filter((d) => rowOf.has(d.name));
    const titleOf = nav.titleOf ?? new Map();
    // the same labels this folder draws below, so the one-label rule merges what would read as twins here too
    const { top, folders } = groupTopLevel(held, nav.declared, nav.workspaceModule, nav.dependsOn, nav.navGroups, nav.namespacesOf, titleOf);
    const placed = new Set(top.map((d) => d.name));
    const walk = (f) => {
        f.collections.forEach((d) => placed.add(d.name));
        f.children.forEach(walk);
    };
    folders.forEach(walk);
    const position = new Map(held.map((d, i) => [d.name, i]));
    const rowsTop = [...top, ...held.filter((d) => !placed.has(d.name))].sort((a, b) => position.get(a.name) - position.get(b.name));
    const folderEntry = (f, parentKey) => ({
        kind: "folder",
        folder: f,
        label: groupLabel(f.key, titleOf, parentKey),
        entries: [
            ...f.collections.map((d) => ({ kind: "row", row: rowOf.get(d.name) })),
            ...f.children.map((c) => folderEntry(c, f.key)),
        ],
    });
    return orderTopLevel(rowsTop, folders, nav.navOrder).flatMap((e) => e.kind === "collection" ? [{ kind: "row", row: rowOf.get(e.descriptor.name) }] : e.kind === "folder" ? [folderEntry(e.folder)] : []);
}
