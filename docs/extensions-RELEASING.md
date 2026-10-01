# releasing @dreamteamer/extensions

**The tag is the publish.** `release.yml` triggers on `push: tags: ['v*']` and on nothing else. A
merge to `main` can never publish. That is the same gate the engine uses, and it is deliberate: the
permission to release is a person pushing a tag.

## before the first release ever

Three things must exist on the GitHub repo, and none of them belongs in a file here:

```bash
# an npm automation token for the dreamteamer org — Settings → Access Tokens on npmjs.com
gh secret set NPM_TOKEN --repo dreamteamer/extensions

# the private-name pattern the leak gate greps for (already set on 2026-09-09)
gh secret set LEAK_NAMES --repo dreamteamer/extensions

# ⚠ the access decision. This package is cut from a private work vault.
#   public      → anyone can install it; npm's unconditional unpublish window is 72 hours
#   restricted  → only members of the dreamteamer npm org can install; needs a paid org plan
# The release fails BEFORE publishing if this is unset, so nobody inherits a default.
gh variable set NPM_ACCESS --repo dreamteamer/extensions --body restricted
```

If `NPM_ACCESS` is `restricted`, every machine that installs the package must be logged in to npm as
an org member — including any CI that runs `npm ci` in a consuming workspace.

## every release

```bash
cd <your clone of dreamteamer/extensions>
git status --short && git log origin/main..HEAD --oneline   # what is actually shipping

npm test                                                    # QUOTE THE EXIT CODE
npm pack --dry-run                                          # read the file list — no .models, no caches

git add <explicit paths> && git commit && git push origin main
# ── wait for ci AND leak-scan to be green on that commit; name the run you watched ──

npm version patch --no-git-tag-version        # or minor / major
git commit -m "0.1.1" -- package.json package-lock.json && git push origin main
# ── wait for CI green again ──

# ── 🔒 the next two lines ARE the publish ──
git tag v0.1.1 && git push origin v0.1.1
```

`release.yml` then re-runs the suite, installs the packed tarball into a virgin workspace on the
published engine and drives it, asserts the tag matches `package.json`, and publishes. Provenance is added only when the source repo is public: npm verifies the sigstore bundle against the repo and refuses a private one (`E422`), so while this repo stays private the package ships without it and turning the repo public turns it on with no edit.

## after it lands

```bash
npm view @dreamteamer/extensions version       # the registry, not the CI log
```

Then in each consuming workspace:

```bash
npm install @dreamteamer/extensions@<the exact version>   # ⚠ a caret on 0.x pins the MINOR
npx dreamteamer compile && npx dreamteamer check
```

## the engine floor

Delivering these modules as one package — through npm or as a `git_modules/` clone — needs engine
**0.24.0**, the release that taught discovery to unpack a `modules/` folder. Copying a single module
folder into `modules/` works on older engines. Each module declares the engine range *it* needs in
its own `package.json`; the package-level floor is enforced by `npx dt-extensions doctor`.

## what the release must never do

Publish locally. Run `npm publish` from a laptop and there is no provenance, no gate, and no record of
what shipped. CI does it, or it does not happen.
