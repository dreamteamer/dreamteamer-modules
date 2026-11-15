# Updating @dreamteamer/knowledge

One section per release, newest first. Each says what you have to **do** in a workspace that
installs this module.

```bash
npx dreamteamer update @dreamteamer/knowledge
npx dreamteamer check
```

---

## 0.2.0 — knowledge depends on companies and meetings, not core (CR-dt-008) — engine 0.49.0

knowledge's `dependencies` are `@dreamteamer/companies` and `@dreamteamer/meetings`, the two modules
whose collections a brief points at, with strict `peerDependencies` floors (`>=0.1.3`, `>=0.3.1`); it no
longer depends on `@dreamteamer/core`, which is a module preset from core 0.12.0. A workspace on core
0.12.0 already has both. Without core: `dt install @dreamteamer/knowledge` brings them and theirs.

knowledge ships `nav.yaml`: on install the engine places `blurbs`, `briefs` and `meta-analyses` in a
Knowledge folder of the workspace's `nav.yaml`, only where the file does not name them yet. Nothing in
the records changes.

## 0.1.0

First release.
