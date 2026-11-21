# Security

## Reporting a vulnerability

Please do not open a public issue. Report it privately through GitHub's security advisories for this
repository: **Security → Report a vulnerability** on https://github.com/dreamteamer/dreamteamer-modules. Say which
package and version, what an attacker needs (a page in the browser, a process on the machine, a hostile file in a
record), and what they get.

## Supported versions

The newest minor version of each `@dreamteamer/*` package gets security fixes. Older minors do not; a package's
`UPDATING.md`, or the release notes at the end of its `README.md` where it ships none, says how to move up.

## Known advisories in dependencies

What `npm audit --omit=dev` reports for the packages published from this repository, and whether each one
reaches a request. Re-measured on every release of the packages named.

None today. The two packages that answered requests, `@dreamteamer/web` (`dt web`) and `@dreamteamer/http`
(`dt serve`), were retired from this repository; the desktop app is the surface for people now.
