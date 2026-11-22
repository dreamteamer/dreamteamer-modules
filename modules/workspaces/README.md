# @dreamteamer/workspaces

```sh
npm install @dreamteamer/workspaces
```

Requires Dreamteamer 0.53.0 or later. Local-only model for desired deployment configuration, independent of `@dreamteamer/work`.
GitHub and Bitbucket are modeled providers, not connected services.

## Model

A configuration snapshot for one organization declares its AI Ops management repository and
keeps its provider, repository catalog, logical users, scoped roles, organization memberships, workspaces,
Work Areas and assignments together. The management repository is a declared location, not an
authorization or a Git checkout performed by this module. `--organization` checks snapshot
self-containment, same-organization scope and presence of an AI Ops role.

Workspace Operators are organization-local end-user memberships. Each has one dedicated Work Area
instance with a separate same-organization Git configuration repository and a full configuration
revision pin. Work Areas own a display setting and a deny-by-default or allowlisted marketplace
policy; no code installs anything. The model reserves secret-reference kinds in TypeScript only;
there are no secret identifiers, values, access or resolution.

Workspaces and Work Areas each use one collection, not parallel template and instance schemas.
Four view descriptors filter the same records by `is_template`. An instance may point back to a
same-type, same-organization template with a full Git revision pin. Pins are syntactic only, not a
claim a remote object exists. Desired assignments point to an organization member and a workspace
instance, with a same-organization AI Ops role as declared provenance, not authenticated authority.
A member’s workspace inventory derives from present assignments rather than a cached list in a Work Area.

The pure grant comparator takes separately supplied, timestamped provider observations. It labels
matches, drift, unknown, stale and conflicting samples; it never fetches provider state or applies
a change. Absent desired assignments do not override grants still desired by another assignment.
Unknown or out-of-scope observations do not establish revocation. Provider identity binding,
checkout, registration, process state and real authorization remain outside this module.

## Local review and validation

After the normal `dreamteamer check`, use the read-only guard:

```sh
dreamteamer run @dreamteamer/workspaces check-records --data-root ./data --organization northwind
```

The optional organization flag requires a populated, single-organization snapshot and rejects
foreign records and an absent AI Ops role. It does not authenticate a Git checkout, organization
or actor. Without it, a valid empty root reports `checked: 0`, not proof of configuration.
Exit 0 means the examined desired records passed checks; 1 means violations, 2 unreadable input
or invocation failure. Only typed frontmatter is accepted. Labels and identifiers must not
contain credentials; the validator is not a secret detector.

There are no provider calls, clone or grant changes, configuration exports, workspace runtime
actions, Electron integration or publication in this local slice. View filters are presentation,
not access control. A real org configuration must be verified independently before creating it.
