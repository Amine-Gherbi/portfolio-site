# k6 checkout load report

Real run from this machine, not a projection. The summary below is copied from
k6's own output; the report states the reduced parameters rather than implying
the planned five-minute profile was executed.

## Run

| | |
| --- | --- |
| Date | 2026-10-23, 01:57 local (UTC+01:00) |
| Machine | Windows 11 Pro 10.0.26200, AMD Ryzen 5 5500U (12 logical cores), 15.3 GiB RAM |
| Runtime | Node 22.23.4, Next.js 15 dev server on `127.0.0.1:3000` |
| Database | PostgreSQL 16.13, local `shop_dev`, no other load |
| k6 | v2.2.0 (windows/amd64) |
| Command | `node scripts/load-fixture.mjs && k6 run load/checkout.js` |
| Scenario | `load/checkout.js` — `per-vu-iterations`, 50 VUs × 5 iterations |
| Planned profile | 50 VUs / 5 minutes |
| Executed profile | **50 VUs / 250 checkouts / 1 min 06 s** — reduced; see below |
| Sample size | **n = 250 checkout requests** (500 HTTP requests including logins) |
| Errors | **0.00 %** (250/250 returned `201` with the server-computed total) |

The five-minute profile was not run. The card allows a reduction as long as it
is stated: each VU performs five iterations and then stops, so the run ends
after 66 seconds instead of holding 50 VUs for five minutes. n is 250, which is
enough for a p50/p95/p99 point estimate and not enough for a tight tail.

## Result

`checkout_duration` is the `POST /api/checkout` response time only; login time
is excluded.

| Metric | Value |
| --- | --- |
| p50 (k6 `med`) | **1.96 s** |
| p95 | **2.66 s** |
| p99 | **2.88 s** |
| mean | 1.76 s |
| min | 84.06 ms |
| max | 3.07 s |
| error rate | 0.00 % |
| orders created | 250 |
| throughput | 3.76 checkouts/s |

Raw k6 summary (abridged to the relevant lines):

```text
CUSTOM
checkout_duration..............: avg=1.76s  min=84.06ms med=1.96s  p(90)=2.47s  p(95)=2.66s  p(99)=2.88s  max=3.07s count=250
checkout_errors................: 0.00%  0 out of 250
orders_created.................: 250    3.763446/s

HTTP
http_req_duration..............: avg=1.46s  min=76.96ms med=1.59s  p(90)=2.13s  p(95)=2.47s  p(99)=2.87s  max=3.07s count=500
http_req_failed................: 0.00%  0 out of 500

EXECUTION
iterations.....................: 250    3.763446/s
vus............................: 34     min=34       max=50
vus_max........................: 50     min=50       max=50

running (1m06.4s), 00/50 VUs, 250 complete and 0 interrupted iterations
```

## Method

1. `node scripts/load-fixture.mjs` recreates 250 users (`load-0…249@alder.test`)
   against `shop_dev`, each with one cart holding one unit of a dedicated
   `LOAD-001` variant (stock 100,000, price 1,999 cents). The seed removes prior
   load users, their orders and reservations first, so reruns are clean.
2. Each VU signs in as five distinct accounts. Login is `POST /api/login` with
   a unique `X-Forwarded-For` per account; the per-IP and per-account windows
   therefore never collide, and no request is a 429.
3. Each account is used for exactly one checkout. The unique
   `(userId, idempotencyKey)` is new every iteration, so all 250 are real order
   creations — none is an idempotent replay.
4. Every response is checked for `201` and for `totalCents === 1999`; a forged
   or recomputed-away total would fail the run.

Reproduce:

```bash
npm run dev                          # in one terminal, shop_dev seeded
node scripts/load-fixture.mjs        # 250 users, one cart each
k6 run load/checkout.js
node scripts/load-fixture.mjs --cleanup
```

## What this number is not

- **It is not a production number.** The app runs under `next dev`, not
  `next start`: `NODE_ENV=production` refuses to create the local
  `pi_local_*` payment intent when no `STRIPE_SECRET_KEY` is present, and no
  key is configured on this machine. Dev-mode compilation and request handling
  are slower than a production build; the latencies above are a real
  measurement of this stack, not a claim about a production deployment.
- **The 50 simultaneous argon2 logins share the CPU with the checkouts.** Each
  VU logs in immediately before it checks out, so argon2id verification
  competes with the checkout transaction. This is why the p50 is ~2 s. A
  scenario that pre-issues session cookies would isolate the checkout path;
  this one measures a realistic "sign in, buy" sequence under concurrency.
- **One machine, one database.** Local PostgreSQL over TCP, single node,
  no network latency and no managed-database variance.
- **n = 250, one run.** p99 is an estimate from 250 samples. There is no
  confidence interval and no repeated run to separate the tail from noise.
