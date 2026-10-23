# Proof map — portfolio-site

Every number rendered by the hub is copied from a source repository's committed
proof. This page maps each claim the site shows to the command that reproduces
it and to the repository that owns it. The hub measures nothing itself: it
renders `public/assets/<slug>/manifest.json`, and `npm run check:assets` only
verifies that each cited artifact exists in the snapshot.

Snapshot captured 2026-10-23 and 2026-10-24. Rows below cover the `claim` line
of each case study, every `proof.measured` entry, and every `proof.invariants`
entry — that is, every factual claim the case-study pages render. The
home-page positioning sentence ("I build full-stack web systems for teams that
need to prove their software works") is a statement of intent, not a
measurement, so it has no row.

## Site gate

| Claim | Command | Owner |
| --- | --- | --- |
| The site builds, every manifest validates and every cited proof artifact exists | `npm run verify` (runs `astro check`, `tsc --noEmit`, `check:assets`, `astro build`) | `portfolio-site` |
| Every case study has six sections, one failure, 250–450 narrative words and no uncited number | `npm run check:content && npm run check:copy` | `portfolio-site` |

All commands below are run from the owning repository. The artifact column names
the file under `public/assets/<slug>/proof/` that the site serves.

## E-commerce platform — `P:/portfolio/ecommerce-platform`

| Claim on the site | Command that reproduces it | Snapshot artifact |
| --- | --- | --- |
| A recorded run of 20 concurrent checkouts against stock 5 created 5 orders and 15 rejections, leaving stock 0 and 5 open reservations | `npx vitest run tests/integration/checkout.oversell.test.ts --reporter=verbose` | `docs/proof/concurrency-run.txt` |
| p95 4.58 s, 248 orders, 2 P2028 timeouts over 250 checkout requests (50 VUs × 5 iterations) | `node scripts/load-fixture.mjs && k6 run load/checkout.js` against a production `next start` | `docs/load/checkout.md` |
| 181 tests in 33 files and 5 Playwright tests passed | `npm run verify` (ESLint, `tsc --noEmit`, Vitest, `prisma migrate diff`, Playwright) | `docs/proof/verify.txt` |
| A forged total in the checkout body cannot change the charge | `npx vitest run tests/integration/checkout.forged-price.test.ts` | `tests/integration/checkout.forged-price.test.ts` |
| One order per `(userId, idempotencyKey)` under concurrent double submit | `npx vitest run tests/integration/checkout.double-submit.test.ts` | `tests/integration/checkout.double-submit.test.ts` |
| 20 concurrent checkouts on stock 5 create exactly 5 orders and stock never goes negative | `npx vitest run tests/integration/checkout.oversell.test.ts` | `tests/integration/checkout.oversell.test.ts` |
| A replayed Stripe webhook is a 200 no-op | `npx vitest run tests/integration/webhook.replay.test.ts` | `tests/integration/webhook.replay.test.ts` |

The 181-test row is a gate result, not a performance metric; the case-study
page filters it out of the metrics list. The load run used 250 checkout
requests on one Windows machine, so p95 4.58 s is not a production number.
`git remote -v` is empty: no deployment and no CI run is claimed.

## CI/CD deployment pipeline — `P:/portfolio/cicd-pipeline`

| Claim on the site | Command that reproduces it | Snapshot artifact |
| --- | --- | --- |
| 9/9 integration tests passed; exit 0 | `bash scripts/verify.sh` | `docs/evidence/verify.txt` |
| 5/5 smoke assertions passed; `/ready` p95 7.7 ms | `bash scripts/smoke.sh` against the running release on 127.0.0.1:8787 | `docs/evidence/smoke.txt` |
| 8 gates feed `ci-ok`; 20 `uses`, 0 unpinned | workflow structure check (snippet below) over `.github/workflows/pr.yml` | `docs/evidence/workflow-structure.txt` |
| `deploy.start → health.ok → smoke.fail → rollback.start → rollback.health.ok → rollback.smoke.ok` | `grep -nE '^(deploy\.start\|health\.ok\|smoke\.(ok\|fail)\|rollback\.)' deploy.log` | `deploy.log` |
| Unauthenticated `POST /invoices` is rejected; an authenticated request returns a UUID id | `npx vitest run tests/integration/api.test.ts` | `tests/integration/api.test.ts` |
| `GET /ready` reports `pending_migrations` when a migration is unapplied, and is ready otherwise | `npx vitest run tests/integration/api.test.ts` | `tests/integration/api.test.ts` |
| An unknown invoice id returns 404 `not_found` with no stack trace | `npx vitest run tests/integration/api.test.ts` | `tests/integration/api.test.ts` |

Workflow structure check:

```bash
node -e '
const fs=require("node:fs");
const s=fs.readFileSync(".github/workflows/pr.yml","utf8");
const jobs=[...s.matchAll(/^ {2}([a-z][a-z0-9-]*):$/gm)].map((m)=>m[1]);
const uses=[...s.matchAll(/uses: (\S+)/g)].map((m)=>m[1]);
console.log("jobs:", jobs.join(", "));
console.log("needs:", /needs: \[([^\]]+)\]/.exec(s)[1]);
console.log("uses:", uses.length, "unpinned:", uses.filter((u)=>!/@[0-9a-f]{40}$/.test(u)).length);
'
```

The GitHub Actions lane has never run (`git remote -v` is empty). Only the
local release and rollback lane is measured; the committed screenshots are
renders of repository output, not captures of a browser UI.

## Document Q&A assistant — `P:/portfolio/docqa-assistant`

Run `bash scripts/fetch-corpus` once before any command below; the corpus PDFs
are not committed.

| Claim on the site | Command that reproduces it | Snapshot artifact |
| --- | --- | --- |
| Retrieval recall@8 is 18/24 (75.0%), Wilson 95% [55.1%, 88.0%] | `bash scripts/live.sh eval` | `eval-report.json` |
| Answer rate is 8/24 (33.3%), Wilson 95% [18.0%, 53.3%] — gate FAIL | `bash scripts/live.sh eval` | `eval-report.json` |
| Unanswerable refusal is 6/6 (100.0%), Wilson 95% [61.0%, 100.0%] | `bash scripts/live.sh eval` | `eval-report.json` |
| Citation precision and faithfulness are 7/9 (77.8%) each, rule-based, gates FAIL | `bash scripts/live.sh eval` | `eval-report.json` |
| The production eval run took 778.6 s, 30 questions, 26 model requests, 0 retries, 0 rate limits | `bash scripts/live.sh eval`; read `provenance.run` in the report | `docs/ENV.md` |
| The forced-generation diagnostic answers 8/24 (33.3%) with `gate_run: false` | `bash scripts/live.sh eval --force-generation` | `eval-report-forced.json` |
| A chunk longer than 448 model tokens fails ingest instead of storing a truncated vector | `uv run pytest tests/test_chunking.py` | `tests/test_chunking.py` |
| A claim without an in-context citation, or whose quote is not a normalised substring of the cited chunk, is dropped | `uv run pytest tests/test_citations.py` | `tests/test_citations.py` |
| Ingest refuses a PDF whose SHA-256 differs from `corpus.lock.json` | `uv run pytest tests/test_lock.py` | `tests/test_lock.py` |
| The refusal threshold comes from `eval/calibration.json` at boot and is never hand-tuned | `uv run pytest tests/test_refusal.py` | `tests/test_refusal.py` |
| Every rate carries a Wilson 95% interval and its denominator; the earliest failed stage is recorded per question | `uv run pytest tests/test_eval.py` | `tests/test_eval.py` |
| The judge model differs from the generator and is pinned by exact id; its reliability is unverified | `uv run pytest tests/test_judge_check.py` | `tests/test_judge_check.py` |
| ONNX work runs in a worker thread behind `Semaphore(2)` | `uv run pytest tests/test_embedder.py` | `tests/test_embedder.py` |

The eval set is 30 questions, not the planned 100; the calibration is fitted
in-sample; the generator is a free endpoint with no SLA. Those limits are
rendered on the case-study page from the manifest and are not softened here.

## Snapshot provenance

| Project | Captured | How |
| --- | --- | --- |
| `ecommerce-platform` | 2026-10-24 00:33 local (Europe/Algiers) | Re-seeded with `npx prisma db seed -- --seed 42`, then captured at 1440×900 CSS px and deviceScaleFactor 2. The pre-existing server on 127.0.0.1:3000 returned HTTP 500 on every `/c/*` category route, so the shots came from an unmodified copy of the repository at 127.0.0.1:3100 under `next build && next start` against the same seeded PostgreSQL database. The 3000 process was not started here and was left running. |
| `docqa-assistant` | 2026-10-23 23:26 UTC | `uv run python scripts/capture-assets` captured the sample-answer state with all three sources visible from the Vite UI on 127.0.0.1:5173 (5174 was not running) and the API on 127.0.0.1:8788. Recorded demo answers; no live model call. |
| `cicd-pipeline` | 2026-10-23 00:54 UTC | Existing four shots retained. The repository has no browser UI; each shot is a render of repository output, and the source files they depict (`pr.yml`, the recorded `deploy.log` release/rollback run, `smoke.txt`, `release-status.txt`) are unchanged since capture. Regenerate with `node scripts/capture-assets.mjs` if a depicted file changes. |

Every shot in the snapshot is 2880×1800 WebP with no browser chrome.
