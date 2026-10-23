# k6 checkout load report

One run, from this machine, against the rebuilt app. The numbers below are
copied from k6's summary and the server log; they are not a projection.

## Run

| | |
| --- | --- |
| Date | 2026-10-23, 22:52–22:53 local (UTC+01:00) |
| Machine | Windows 11 Pro 10.0.26200, AMD Ryzen 5 5500U, 12 logical cores, 15.3 GiB RAM |
| Runtime | Node 22.23.4, Next.js 15.5.28 `next start` (production build) on `127.0.0.1:3000` |
| Database | PostgreSQL 16.13, local `shop_dev`, no other load |
| k6 | v2.2.0 (windows/amd64) |
| Command | `node scripts/load-fixture.mjs && k6 run load/checkout.js` |
| Scenario | `load/checkout.js` — `per-vu-iterations`, 50 VUs × 5 iterations |
| Executed profile | 50 VUs / 250 checkout requests / 59.0 s |
| HTTP requests | **750** — 250 × (CSRF + credentials callback + checkout) |
| Checkout errors | **0.80 %** — 2 of 250 (`checkout_errors` threshold `rate<0.01` passed) |
| Orders created | **248** |

The planned profile allows `maxDuration` 5 minutes; every VU finished its five
iterations in 59 seconds, so the run ended on iteration count, not on a timeout
or a reduced duration. `checkout_duration` measures only `POST /api/checkout`;
sign-in is outside it.

## Result

| Metric | Value |
| --- | --- |
| p50 (`med`) | 521.43 ms |
| p95 | **4.58 s** |
| p99 | 4.86 s |
| mean | 901.79 ms |
| min | 28.4 ms |
| max | 5.03 s |
| samples (`count`) | 250 |
| orders created | 248 (4.20/s) |
| HTTP requests | 750 |
| HTTP failures | 2 (0.26 %) |

Raw k6 summary, abridged to the relevant lines:

```text
checks_total.......: 750    12.706677/s
checks_succeeded...: 99.20% 744 out of 750
checks_failed......: 0.80%  6 out of 750

CUSTOM
checkout_duration..............: avg=901.79ms min=28.4ms med=521.43ms p(90)=1.79s p(95)=4.58s p(99)=4.86s max=5.03s count=250
checkout_errors................: 0.80%  2 out of 250
orders_created.................: 248    4.201674/s

HTTP
http_req_duration..............: avg=442.79ms min=3.56ms med=226.34ms p(90)=960.95ms p(95)=1.28s p(99)=4.75s max=5.03s count=750
http_req_failed................: 0.26%  2 out of 750
http_reqs......................: 750    12.706677/s

EXECUTION
iterations.....................: 250    4.235559/s
vus............................: 8      min=8        max=50
vus_max........................: 50     min=50       max=50

running (0m59.0s), 00/50 VUs, 250 complete and 0 interrupted iterations
```

## The two failures

Both failed checkouts are the same error in the `next start` log:

```text
PrismaClientKnownRequestError: Transaction API error: Unable to start a transaction in the given time.
  code: 'P2028'
  clientVersion: '6.19.3'
```

Prisma's interactive-transaction `maxWait` expired before a connection was
available. The default Prisma pool is `2 × logical CPUs + 1` = 13 connections
for 50 VUs all opening a checkout transaction. The failure happens before the
transaction starts, so there is no order, no reservation and no stock change to
clean up. Queried immediately after the run, `shop_dev` held:

```text
load orders              = 248
open load reservations   = 248
LOAD-001 stock           = 99752   (100000 − 248)
```

So the error rate is a connection-pool limit, not an oversell or a lost
reservation. A retry is safe: the `(userId, idempotencyKey)` index returns the
existing order if the first attempt did commit.

## Method

1. `node scripts/load-fixture.mjs` deletes prior load users, orders and
   reservations, then creates 250 users (`load-0…249@kestrel.test`), one
   address and one cart per user, each holding one unit of a dedicated
   `LOAD-001` variant (`priceCents` 1,999, stock 100,000).
2. `load/checkout.js` runs `per-vu-iterations`, 50 VUs × 5 iterations.
3. Each iteration signs in through Auth.js: `GET /api/auth/csrf`, then
   `POST /api/auth/callback/credentials`. k6 keeps one cookie jar per VU, so
   the session cookie is sent to `/api/checkout`.
4. Every account is used once and every `(userId, idempotencyKey)` is new, so
   all 250 requests are real order creations, not replays. Each account also
   gets a unique `X-Forwarded-For`, so the per-email + per-IP sign-in limiter
   cannot collapse the run into one bucket.
5. Each response is checked for `201`, `subtotalCents === 1999` and
   `totalCents === 2489` (1,999 + 490 standard shipping, since the subtotal is
   below the 8,000 free-shipping threshold). A forged or stale total fails the
   check.

Reproduce:

```bash
npx prisma db seed -- --seed 42
npm run build && npm start          # terminal 1
node scripts/load-fixture.mjs       # terminal 2
k6 run load/checkout.js
node scripts/load-fixture.mjs --cleanup
```

## What this number is not

- **Not a capacity number.** One machine, one local PostgreSQL, one run, n =
  250. The 13-connection default pool is the reason for the tail; a larger
  pool would move both the p95 and the error count.
- **Not a network benchmark.** Client, server and database share one host.
- **Not a Stripe measurement.** Checkout writes a simulated `pi_demo_*`
  PaymentIntent id; no external payment call is made.
- **Not a repeated run.** There is no confidence interval. p99 is an estimate
  from 250 samples.
