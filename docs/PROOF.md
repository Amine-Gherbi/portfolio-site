# Proof map — portfolio-site

Every number rendered by the hub is copied from a source repository's committed
proof. This page maps each claim the site shows to the command that reproduces
it and to the repository that owns it. The hub measures nothing itself: it
renders `public/assets/<slug>/manifest.json`, and `npm run check:assets` only
verifies that each cited artifact exists in the snapshot.

Rows below cover the `live` block, the `claim` line of each case study, every
`proof.measured` entry and every `proof.invariants` entry — that is, every
factual claim the case-study pages render. The home-page positioning sentence
is a statement of intent, not a measurement, so it has no row.

## Site gate

| Claim | Command | Owner |
| --- | --- | --- |
| The site builds, every manifest validates and every cited proof artifact exists | `npm run verify` (runs `astro check`, `tsc --noEmit`, `check:assets`, `astro build`) | `portfolio-site` |
| Every case study has five sections, one failure, 250–450 narrative words and no uncited number | `npm run check:content && npm run check:copy` | `portfolio-site` |
| No rendered date | `grep -rnE "20[0-9]{2}-[0-9]{2}-[0-9]{2}" src public` | `portfolio-site` |

All commands below are run from the owning repository. The artifact column names
the file under `public/assets/<slug>/proof/` that the site serves. Where the
source transcript contains a timestamp, the snapshot cites the date-free source
file and the case study links the raw transcript on GitHub, so the hub renders
no date.

## E-commerce platform — `P:/portfolio/ecommerce-platform`

Live: <https://kestrel-store.onrender.com> · code:
<https://github.com/Amine-Gherbi/ecommerce-platform>

| Claim on the site | Command that reproduces it | Snapshot artifact |
| --- | --- | --- |
| Order `KST-2610-53808809` is `PAID`; PaymentIntent `pi_3UVxhPAFU9sk1cqL2t0HAlmV` for 14900 cents; one signed delivery; a replay answers 200 `duplicate` | `BASE_URL=https://kestrel-store.onrender.com node scripts/live-payment-proof.mjs` with the Stripe test keys | `scripts/live-payment-proof.mjs` |
| 20 concurrent checkouts on stock 5 produced 5 orders and 15 rejections, stock 0, 5 open reservations | `npx vitest run tests/integration/checkout.oversell.test.ts --reporter=verbose` | `tests/integration/checkout.oversell.test.ts` |
| p95 4.58 s, 248 orders, 2 P2028 timeouts over 250 checkout requests (50 VUs × 5 iterations) | `node scripts/load-fixture.mjs && k6 run load/checkout.js` against a production `next start` | `load/checkout.js` |
| 181 tests in 33 files and 5 Playwright tests passed | `npm run verify` (ESLint, `tsc --noEmit`, Vitest, `prisma migrate diff`, Playwright) | `package.json` |
| A forged total in the checkout body cannot change the charge | `npx vitest run tests/integration/checkout.forged-price.test.ts` | `tests/integration/checkout.forged-price.test.ts` |
| One order per `(userId, idempotencyKey)` under concurrent double submit | `npx vitest run tests/integration/checkout.double-submit.test.ts` | `tests/integration/checkout.double-submit.test.ts` |
| An amount mismatch becomes `REFUND_REQUIRED`, never `PAID` | `npx vitest run tests/integration/checkout.amount-mismatch.test.ts` | `tests/integration/checkout.amount-mismatch.test.ts` |
| A replayed Stripe webhook is a 200 no-op | `npx vitest run tests/integration/webhook.replay.test.ts` | `tests/integration/webhook.replay.test.ts` |
| Expired reservations release stock and cancel the order | `npx vitest run tests/integration/reservations.sweeper.test.ts` | `tests/integration/reservations.sweeper.test.ts` |

The 181-test row is a gate result, not a performance metric; the case-study page
filters it out of the metrics list. The load run used 250 checkout requests on
one Windows machine, so p95 4.58 s is not a production number. Raw transcripts:
[`docs/PROOF.md`](https://github.com/Amine-Gherbi/ecommerce-platform/blob/master/docs/PROOF.md#live-deployment),
[`docs/proof/concurrency-run.txt`](https://github.com/Amine-Gherbi/ecommerce-platform/blob/master/docs/proof/concurrency-run.txt),
[`docs/proof/verify.txt`](https://github.com/Amine-Gherbi/ecommerce-platform/blob/master/docs/proof/verify.txt).

## CI/CD deployment pipeline — `P:/portfolio/cicd-pipeline`

Live: <https://pipeline-demo-57mh.onrender.com> · API:
<https://invoice-api-26b4.onrender.com> · code:
<https://github.com/Amine-Gherbi/cicd-pipeline>

| Claim on the site | Command that reproduces it | Snapshot artifact |
| --- | --- | --- |
| A healthy release passes 5/5 smoke assertions, a broken release misses one, and rollback passes 5/5 | `bash scripts/demo.sh` against the local release on 127.0.0.1:8787 | `docs/evidence/demo.txt` |
| 5/5 smoke assertions passed; `/ready` p95 7.7 ms | `bash scripts/smoke.sh` against the running release | `docs/evidence/smoke.txt` |
| 0 CRITICAL/HIGH findings with `ignore-unfixed`; exit 0 | `trivy image --severity CRITICAL,HIGH --ignore-unfixed --exit-code 1 invoice-api:slim` | `docs/evidence/trivy-local.txt` |
| 9 jobs including `ci-ok`; 20 pinned `uses`; 0 unpinned | workflow structure check (snippet below) over `.github/workflows/pr.yml` | `docs/evidence/workflow-structure.txt` |
| 9/9 integration tests passed; `verify: ok`; exit 0 | `bash scripts/verify.sh` | `docs/evidence/verify-latest.txt` |
| Unauthenticated `POST /invoices` is rejected; an authenticated request returns a UUID id | `npx vitest run tests/integration/api.test.ts` | `tests/integration/api.test.ts` |
| `GET /ready` reports `pending_migrations` when a migration is unapplied, and is ready otherwise | `npx vitest run tests/integration/api.test.ts` | `tests/integration/api.test.ts` |
| An unknown invoice id returns 404 `not_found` with no stack trace | `npx vitest run tests/integration/api.test.ts` | `tests/integration/api.test.ts` |

Hosted evidence, linked by the case study rather than copied:

- Green demo run: <https://github.com/Amine-Gherbi/cicd-pipeline/actions/runs/40929946794>
- Red demo run: <https://github.com/Amine-Gherbi/cicd-pipeline/actions/runs/40930412365> — stops at `bad-image-trivy` with 10 HIGH findings in the pinned base image.
- Rollback: deploy `dep-dbhonnk9v7es73bg70f0` → `dep-dbhoo3rbc2fs73f1b85g`, then `rollback.health.ok` and `rollback.smoke.ok` (5/5). Raw transcript: [`deploy.log`](https://github.com/Amine-Gherbi/cicd-pipeline/blob/master/deploy.log).
- Ruleset `main-protection` (id 26152163) requires the literal `ci-ok`; a direct push to `master` is refused. `gh api repos/Amine-Gherbi/cicd-pipeline/rulesets/26152163`.

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

The screenshots in the snapshot are renders of repository output, not captures
of a browser UI.

## Document Q&A assistant — `P:/portfolio/docqa-assistant`

Live: <https://marginalia-ui.onrender.com> · API:
<https://marginalia-api-4pvl.onrender.com> · code:
<https://github.com/Amine-Gherbi/docqa-assistant>

Run `bash scripts/fetch-corpus` once before the local commands below; the corpus
PDFs are not committed.

| Claim on the site | Command that reproduces it | Snapshot artifact |
| --- | --- | --- |
| Retrieval recall@8 is 18/24 (75.0%), Wilson 95% [55.1%, 88.0%] | `bash scripts/live.sh eval` | `docs/EVAL.md` |
| Answer rate is 15/24 (62.5%), Wilson 95% [42.7%, 78.8%] | `bash scripts/live.sh eval` | `docs/EVAL.md` |
| Unanswerable refusal is 6/6 (100.0%), Wilson 95% [61.0%, 100.0%] | `bash scripts/live.sh eval` | `docs/EVAL.md` |
| Citation precision and faithfulness are 13/15 (86.7%) and 12/15 (80.0%), rule-based | `bash scripts/live.sh eval` | `docs/EVAL.md` |
| The keyed production run took 710.3 s, 30 questions, 26 requests, 0 retries, 0 rate limits | `bash scripts/live.sh eval`; read `provenance.run` in the report | `docs/ENV.md` |
| Hosted `/ask` returned 200 in 27.5 s with a citation on page 8 (chunk 128) | `curl -X POST https://marginalia-api-4pvl.onrender.com/ask -H 'Content-Type: application/json' -d '{"question":"Why is SBERT more efficient than a BERT cross-encoder?"}'` | `src/docqa/api.py` |
| A chunk longer than 448 model tokens fails ingest instead of storing a truncated vector | `uv run pytest tests/test_chunking.py` | `tests/test_chunking.py` |
| A claim without an in-context citation, or whose quote is not a normalised substring of the cited chunk, is dropped | `uv run pytest tests/test_citations.py` | `tests/test_citations.py` |
| The refusal threshold comes from `eval/calibration.json` at boot and is never hand-tuned | `uv run pytest tests/test_refusal.py` | `tests/test_refusal.py` |
| Every rate carries a Wilson 95% interval and its denominator; the earliest stage is recorded per question | `uv run pytest tests/test_eval.py` | `tests/test_eval.py` |
| The judge model differs from the generator and is pinned by exact id; its reliability is recorded by the judge check | `uv run pytest tests/test_judge_check.py` | `tests/test_judge_check.py` |
| ONNX work runs in a worker thread behind `Semaphore(2)` | `uv run pytest tests/test_embedder.py` | `tests/test_embedder.py` |

The eval set is 30 questions, not the planned 100; the calibration is fitted
in-sample; the generator is a free tier with no SLA. Those limits are rendered
on the case-study page from the manifest and are not softened here.

`tests/test_lock.py` verifies the SHA-256 ingest lock. Its fixture carries
timestamps, so the snapshot cites the date-free tests above and the case study
does not render a lock claim.

## Snapshot provenance

`public/assets/<slug>/` holds the manifest, four 2880×1800 WebP shots and the
proof files named above. Sync copies each proof file byte for byte from the
source repository; nothing in the snapshot is rewritten. The earlier dated
transcripts remain in their repositories and are linked from the case studies on
GitHub. Every shot is 2880×1800 WebP with no browser chrome.
