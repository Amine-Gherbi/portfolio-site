// Checkout load scenario.
//
//   node scripts/load-fixture.mjs
//   k6 run load/checkout.js
//
// Each virtual user owns five pre-seeded accounts (250 users / 50 VUs). Every
// iteration signs in as a different account and posts `{addressId,
// cartVersion}` to /api/checkout once, so every checkout is a real order
// creation (201), not an idempotent replay. Accounts and X-Forwarded-For
// addresses are unique per iteration; the rate limiter allows five attempts
// per minute for each, and each account is used once.
//
// Sign-in goes through Auth.js: GET /api/auth/csrf (which sets the CSRF
// cookie), then POST /api/auth/callback/credentials with the token in the
// form body. k6 keeps one cookie jar per VU, so the session cookie set by the
// callback is what /api/checkout sees.
//
// The planned profile is 50 VUs for 5 minutes. A shorter run is a deliberate
// reduction recorded in docs/load/checkout.md, with the sample size stated.
import http from "k6/http";
import { check, sleep } from "k6";
import { Counter, Rate, Trend } from "k6/metrics";

// `open()` resolves relative to this script, so the generated fixture sits
// beside it as load/fixture.json.
const fixture = JSON.parse(open(__ENV.FIXTURE ?? "fixture.json"));
const baseUrl = __ENV.BASE_URL ?? fixture.baseUrl;
const vus = Number(__ENV.VUS ?? "50");
// Default: every fixture account is used exactly once. `PER_VU` is an
// override for smoke runs; the report states whichever profile executed.
const perVu = Number(__ENV.PER_VU ?? Math.ceil(fixture.users.length / vus));
const sleepSeconds = Number(__ENV.SLEEP ?? "10");

export const options = {
  scenarios: {
    checkout: {
      executor: "per-vu-iterations",
      vus,
      iterations: perVu,
      maxDuration: __ENV.MAX_DURATION ?? "5m",
      gracefulStop: "10s",
    },
  },
  thresholds: {
    checkout_errors: ["rate<0.01"],
  },
  summaryTrendStats: ["avg", "min", "med", "p(90)", "p(95)", "p(99)", "max", "count"],
};

const checkoutDuration = new Trend("checkout_duration", true);
const checkoutErrors = new Rate("checkout_errors");
const ordersCreated = new Counter("orders_created");
const ordersReplayed = new Counter("orders_replayed");
const loginsFailed = new Counter("logins_failed");

function formBody(values) {
  return Object.entries(values)
    .map(([key, value]) => `${key}=${encodeURIComponent(value)}`)
    .join("&");
}

export default function () {
  const index = (__VU - 1) * perVu + __ITER;
  const user = fixture.users[index];
  if (user === undefined) {
    return;
  }

  // A unique client address per account keeps the per-IP checkout window from
  // collapsing 50 VUs into one bucket. The app trusts this header only for
  // local/proxy deployments; the load driver is the trusted proxy here.
  const forwardedFor = `198.18.${Math.floor(index / 250)}.${(index % 250) + 1}`;
  const headers = { origin: baseUrl, "x-forwarded-for": forwardedFor };

  const csrf = http.get(`${baseUrl}/api/auth/csrf`, {
    headers,
    tags: { name: "GET /api/auth/csrf" },
  });

  let csrfToken = "";
  try {
    csrfToken = String(csrf.json().csrfToken ?? "");
  } catch {
    csrfToken = "";
  }

  const login = http.post(
    `${baseUrl}/api/auth/callback/credentials`,
    formBody({
      csrfToken,
      email: user.email,
      password: fixture.password,
      callbackUrl: `${baseUrl}/account`,
    }),
    {
      headers: {
        ...headers,
        "content-type": "application/x-www-form-urlencoded",
      },
      redirects: 0,
      tags: { name: "POST /api/auth/callback/credentials" },
    },
  );

  // A failed credentials sign-in also redirects, but to `?error=...`.
  const location = login.headers.Location ?? login.headers.location ?? "";
  const loginOk =
    (login.status === 302 || login.status === 303) &&
    csrfToken.length > 0 &&
    !location.includes("error=");
  if (!loginOk) {
    loginsFailed.add(1);
  }

  const response = http.post(
    `${baseUrl}/api/checkout`,
    JSON.stringify({ addressId: user.addressId, cartVersion: user.cartVersion }),
    {
      headers: { ...headers, "content-type": "application/json" },
      tags: { name: "POST /api/checkout" },
    },
  );

  checkoutDuration.add(response.timings.duration);

  const ok = check(response, {
    "checkout returns 201": (result) => result.status === 201,
    "server-computed subtotal": (result) => {
      try {
        return result.json().subtotalCents === fixture.priceCents;
      } catch {
        return false;
      }
    },
    "server-computed total": (result) => {
      try {
        return result.json().totalCents === fixture.totalCents;
      } catch {
        return false;
      }
    },
  });
  checkoutErrors.add(!ok);

  if (response.status === 201) {
    ordersCreated.add(1);
  } else if (response.status === 200) {
    ordersReplayed.add(1);
  }

  sleep(sleepSeconds);
}
