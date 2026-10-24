# Asset contract — portfolio-site

The hub builds from committed snapshots only. `P:/portfolio/_shared/assets` is
input to a human-run sync, never read by `astro build`.

## Manifest

`public/assets/<slug>/manifest.json` is validated by
`src/lib/manifest-schema.mjs`, which is imported by the build
(`src/lib/manifest.ts`), `check:assets` and `sync:assets`. One schema, three
callers.

| Field | Rule |
|---|---|
| `project` | Equals the directory name. |
| `title`, `oneLiner` | Non-empty; written into MDX by sync. |
| `stack` | 1–6 non-empty entries; written into MDX by sync. |
| `generatedAt` | Optional. An ISO timestamp or an empty string; the re-captured manifests omit it. |
| `seeded` | Exactly `true`. |
| `shots` | Exactly four: `hero.webp`, `shot-01.webp`, `shot-02.webp`, `shot-03.webp`, each 2880×1800 WebP with alt text. |
| `proof.measured[]` | `label`, `value` (**string**), `method` (non-empty), `artifact` (repo-relative path that exists). |
| `proof.invariants[]` | `claim` plus `test`, which must be a test path and exist (`tests/…`, `*.test.*`, `*.spec.*`). |
| `proof.limits` | At least 3 honest entries. |

`proof` is required. `value` is a string on purpose: `180` fails,
`"180 ms"` passes.

## Snapshot layout

```
public/assets/<slug>/
  manifest.json
  hero.webp  shot-01.webp  shot-02.webp  shot-03.webp
  proof/<artifact>      # copied byte for byte from the source repo
```

Proof paths in the manifest stay source-relative (`docs/proof/run.md`,
`tests/reservations.spec.ts`). Sync copies each file under `proof/` preserving
that path, so the committed snapshot is self-contained and the build can verify
that every cited file exists. Paths must be relative, use `/`, and contain no
`..`.

## Commands

- `npm run sync:assets -- --from P:/portfolio/_shared/assets` — validates every
  source manifest first, then copies the manifest, shots and proof files, and
  rewrites only `title`, `oneLiner`, `stack`, `updatedAt` in the matching MDX
  frontmatter. Prose is never touched. Any invalid source manifest aborts the
  whole run before a single write.
- `npm run check:assets` — validates the committed snapshot. A **missing**
  manifest is the supported "coming soon" state (exit 0). An **invalid**
  manifest, an absent shot or an absent proof file exits 1 with the field named.
- `npm run test:assets` — 13 cases covering both failure modes plus sync
  idempotence, owned-field writes and refusal to write a bad source.

Source discovery: direct children of `--from`. Underscore-prefixed directories,
including `_fixtures`, are ignored, so a fixture source can never reach the
committed snapshot. A `--repo <slug>=<path>` or `--repo-root <path>` overrides
source repository lookup; otherwise sync uses `<source>/.git`, then
`<from>/../../<slug>/.git`.

## updatedAt

Sync runs `git -C <source repo> log -1 --format=%cI` and writes the date part
(`YYYY-MM-DD`) into the MDX `updatedAt` field. It never calls `now()`. Running
sync twice on unchanged assets produces no byte change; the repository's
`git status --porcelain` stays empty after the first result is committed.

## Current snapshot

`public/assets/` holds exactly the three real projects: `ecommerce-platform`,
`cicd-pipeline` and `docqa-assistant`. Their `proof/` trees are copied from each
source repository. The earlier placeholder slugs are gone; `_fixtures` is not
read, and `scripts/fixture-images.mjs` was deleted with them.

## Failure modes proven

`tests/asset-contract.test.mjs` runs each case against a temporary tree:

| Case | Expected |
|---|---|
| manifest missing | exit 0, "coming soon" |
| three shots | exit 1, `shots … exactly 4 entries` |
| `proof.measured[0].value: 180` | exit 1, `proof.measured[0].value … must be a string` |
| two limits | exit 1, `proof.limits … at least 3 entries` |
| `shots[0].file` absent | exit 1, `shots[0].file is absent from disk` |
| proof artifact absent | exit 1, `proof.measured[0].artifact … absent from the snapshot` |
| invariant test path not a test | exit 1, `proof.invariants[0].test … test path` |
| sync source has a numeric value or missing artifact | exit 1, nothing written |
