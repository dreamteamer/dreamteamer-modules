# Updating @dreamteamer/http

One section per release, newest first. Each says what you have to **do** in a workspace that
installs this module.

```bash
npm install @dreamteamer/http@latest
```

---

## 0.1.1 — a hash is a commit id, and a cross-site request is refused

A security fix. **Upgrade now if you run `dt serve`**, and do not run 0.1.0 on a machine that browses
the web. There is nothing else to do; with the engine, upgrade to `dreamteamer` 0.44.1 as well.

- `GET /history-diff/:name/*id?hash=` and `POST /collections/:name/records-revert/*id` (`{hash}`) take
  a commit hash (4 to 40 hex digits) or `HEAD`. Anything else — a branch name, `HEAD^`, a value that
  is not a string, a repeated `?hash=` — is `400 {error}` and the engine is not called. 0.1.0 handed
  the value to git as given, and git reads a revision that starts with a dash as an option, some of
  which write files; with no token on loopback and no `Origin` on an image request, a page the user
  visited could reach that route.
- Every request a browser marks `Sec-Fetch-Site: cross-site` is `403`, whatever its method or path.
  `curl`, scripts and the editor send no such header and are unaffected; a same-origin page is too.
- Every answer carries `X-Content-Type-Options: nosniff` and `Referrer-Policy: no-referrer`, and no
  longer says `X-Powered-By`.

## 0.1.0

The first release: `dt serve` and the JSON REST api at `/api`.
