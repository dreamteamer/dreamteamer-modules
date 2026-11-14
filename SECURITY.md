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

| package | advisory | reaches a request? |
|---|---|---|
| `@dreamteamer/web` | none: it depends on `@dreamteamer/protocol` and Node's own `http`, and `@dreamteamer/protocol` on `js-yaml` only | — |
| `@dreamteamer/http` (`dt serve`), through `express` 5.2 | [GHSA-27r3-jxmh-p828](https://github.com/advisories/GHSA-27r3-jxmh-p828), `body-parser` 2.0.0–2.3.0: a compressed request body with trailing bytes can stall the parser | **Yes, after the guards.** `dt serve` reads every `/api` body with `express.text`, which inflates compressed bodies. The Host and Origin checks run first, and with `--token` so does the token, so the sender is a process on this machine or a holder of the token. Fixed when `express` takes a `body-parser` outside the affected range |
| `@dreamteamer/http`, through `express` 5.2 | [GHSA-6pq8-jhm2-2vcw](https://github.com/advisories/GHSA-6pq8-jhm2-2vcw), `qs` 6.7.0–6.16.0: `qs.stringify` with `arrayFormat: 'comma'` can throw | No: `dt serve` parses query strings and never calls `qs.stringify` |

`dt web` (`@dreamteamer/web`) has its own threat model, what it protects against and what it does not, in
[modules/web/README.md](modules/web/README.md#security).
