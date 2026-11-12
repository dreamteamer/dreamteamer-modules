# @dreamteamer/personal-workspace

An optional schema-and-view package for a personal HQ. It contains no records, accounts,
credentials, machine paths, automation or publishing code.

## Install

Install the engine and both modules as direct dependencies:

```sh
npm install @dreamteamer/core @dreamteamer/personal-workspace
npm install dreamteamer
npx dreamteamer compile
npx dreamteamer check
```

Use core, not core together with its individual component modules. The personal-workspace
module depends on core 0.9.0 or later and engine 0.43.0 or later.

## Included

- `briefs`: working instructions, constraints and acceptance criteria.
- `blurbs`: reusable short wording.
- `meta-analyses`: cross-meeting or cross-record reviews with coverage dates, sources and limitations.
- `/tasks/personal-board` and `/tasks/personal-list`: active tasks (`todo`, `doing`, `blocked`).
  The list includes creation date. `done` means delivered; `closed` means left without delivery.
  Suggested tasks still need triage and remain accessible through core's existing views.

The package adds views; it does not hide core's existing views or rewrite task records.
It creates no tasks automatically. The shared schemas provide no personal operating rules.

## Existing workspaces

Inspect local collection names before enabling this package. If `briefs`, `blurbs` or
`meta-analyses` already exist, compare their schemas and preserve/back up records before
migrating. This is not an automatic schema replacement or data migration tool. Local display
preferences can remain in a workspace overlay; do not install conflicting full definitions.

Installing a schema does not make a repository private. Verify repository readers and storage
permissions before adding personal records. Source references do not authorize copying their
contents to another repository. Obtain appropriate approval for any cross-workspace transfer.
