#!/usr/bin/env node
// Live proof against the deployed store and the Stripe sandbox.
//
//   set -a; source P:/portfolio/.secrets/host.env; set +a
//   set -a; source P:/portfolio/.secrets/store.env; set +a
//   BASE_URL=https://kestrel-store.onrender.com node scripts/live-payment-proof.mjs
//
// It drives the hosted checkout with Playwright, pays with the Stripe test card
// `4242 4242 4242 4242`, then verifies out of band:
//   * the Payment Element mounted, so the page carried a pk_test_… key;
//   * the order in Neon is PAID and its total is the server-computed amount;
//   * exactly one PaymentIntent exists for the order and its amount matches;
//   * the signed Stripe event was delivered (pending_webhooks = 0);
//   * replaying that exact event returns 200 duplicate and writes no second row.
//
// The script is deliberately outside `tests/e2e`: the browser suite must stay
// hermetic. Every run creates a fresh order, so it can be re-run.
//
// Required environment: BASE_URL, DATABASE_URL, STRIPE_SECRET_KEY,
// STRIPE_WEBHOOK_SECRET. Nothing is printed except ids, amounts and statuses.

import { execFileSync } from "node:child_process";

import { chromium } from "@playwright/test";
import Stripe from "stripe";

const baseUrl = (process.env.BASE_URL ?? "https://kestrel-store.onrender.com").replace(/\/$/, "");
const stripeSecretKey = required("STRIPE_SECRET_KEY");
const webhookSecret = required("STRIPE_WEBHOOK_SECRET");
const databaseUrl = required("DATABASE_URL");
const publishableKey = required("NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY");
assertPublishable(publishableKey);

const DEMO_EMAIL = "demo@kestrel.test";
const DEMO_PASSWORD = "demo-password-123";

// A cart's idempotency key is derived from its lines, so re-adding the same
// single item replays an earlier order instead of creating a new one. Pick a
// product whose default (first in-stock) variant has never appeared in an
// order: its one-line cart is then guaranteed to be fresh on every run.
function chooseProduct() {
  const row = psql(
    `SELECT p.slug, p.title FROM "Product" p WHERE p.status = 'ACTIVE' AND EXISTS (` +
      `SELECT 1 FROM "Variant" v WHERE v."productId" = p.id AND v.stock >= 1 AND v.id = (` +
      `SELECT v2.id FROM "Variant" v2 WHERE v2."productId" = p.id AND v2.stock >= 1 ORDER BY v2.position LIMIT 1` +
      `) AND NOT EXISTS (SELECT 1 FROM "OrderItem" oi WHERE oi.sku = v.sku)) ORDER BY p.slug LIMIT 1;`,
  );
  assert(row.length > 0, "no un-ordered, in-stock product is available");
  const [slug, title] = row.split("|");
  return { slug, title };
}

function required(name) {
  const value = process.env[name];
  if (value === undefined || value.trim().length === 0) {
    throw new Error(`${name} is required`);
  }
  return value.trim();
}

function assertPublishable(value) {
  if (!value.startsWith("pk_test_")) {
    throw new Error("NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY is not a pk_test_ key");
  }
}

function maskKey(value) {
  return value.startsWith("pk_test_") ? `pk_test_…(${value.length} chars)` : "(not a pk_test key)";
}

function psql(sql) {
  return execFileSync(
    "psql",
    ["-t", "-A", "-F", "|", "-c", sql, databaseUrl],
    {
      encoding: "utf8",
      env: { ...process.env, PGPORT: "5432" },
      stdio: ["ignore", "pipe", "pipe"],
    },
  ).trim();
}

function safeNumber(value) {
  if (!/^KST-\d{4}-[0-9A-F]{8}$/.test(value)) {
    throw new Error(`unexpected order number: ${value}`);
  }
  return value;
}

function safeUuid(value) {
  if (!/^[0-9a-f-]{36}$/i.test(value)) {
    throw new Error(`unexpected order id: ${value}`);
  }
  return value;
}

function safeEventId(value) {
  if (!/^evt_[A-Za-z0-9]+$/.test(value)) {
    throw new Error(`unexpected event id: ${value}`);
  }
  return value;
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

const stripe = new Stripe(stripeSecretKey, { maxNetworkRetries: 2 });
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitFor(label, predicate, timeoutMs = 90_000, intervalMs = 3_000) {
  const deadline = Date.now() + timeoutMs;
  let last;
  while (Date.now() < deadline) {
    last = await predicate();
    if (last) {
      return last;
    }
    await sleep(intervalMs);
  }
  throw new Error(`timed out waiting for ${label}`);
}

async function priceInBrowser(page) {
  const subtotal = await page
    .locator("dt, span")
    .filter({ hasText: /^Subtotal$/ })
    .first()
    .locator("xpath=following-sibling::*[1]")
    .innerText();
  const total = await page
    .locator("dt, span")
    .filter({ hasText: /^Total$/ })
    .first()
    .locator("xpath=following-sibling::*[1]")
    .innerText();
  return { subtotal, total };
}

// A completed checkout deletes the cart lines, but a cart with the same
// contents hashes to the same cartVersion and therefore the same idempotency
// key as an earlier order. The proof starts from an empty cart and pays for a
// never-ordered variant, so its one-line cart is fresh on every run.
async function emptyCart(page) {
  await page.goto("/cart", { waitUntil: "domcontentloaded", timeout: 120_000 });
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const remove = page.locator("button:visible", { hasText: "Remove" }).first();
    if ((await remove.count()) === 0) {
      return;
    }
    await remove.click();
    await page.waitForTimeout(1_500);
  }
  throw new Error("could not empty the cart");
}

// The publishable key is inlined into a client bundle at build time. Next loads
// the checkout page chunk through the router, so it is not always a
// `<script src>`; scan same-origin scripts and fetched resources. When the key
// is in this process's environment, require an exact match so a stale build is
// not mistaken for this one.
async function findPublishableKey(page) {
  const expected = publishableKey;
  return page.evaluate(async ({ expected }) => {
    const urls = new Set([
      ...[...document.querySelectorAll("script[src]")].map((node) => node.src),
      ...performance.getEntriesByType("resource").map((entry) => entry.name),
    ]);
    for (const url of urls) {
      if (!url.startsWith(window.location.origin) || !/\.js(\?|$)/.test(url)) {
        continue;
      }
      try {
        const text = await (await fetch(url)).text();
        const match = /pk_test_[A-Za-z0-9]+/.exec(text);
        if (match && (expected.length === 0 || match[0] === expected)) {
          return { src: url, key: match[0] };
        }
      } catch {
        // A chunk that cannot be fetched is not evidence either way.
      }
    }
    return null;
  }, { expected });
}

async function fillPaymentElement(page) {
  const frame = page.frameLocator('iframe[title="Secure payment input frame"]').first();
  const number = frame.locator('input[name="number"], input[autocomplete="cc-number"]').first();

  // Stripe.js mounts the Payment Element asynchronously and opens on a method
  // chooser (Card, Pay By Bank, …). Poll until the card fields or the chooser
  // appear, then choose Card. A free Render instance can be slow to load the
  // checkout chunk, so allow 90 s for the first frame contents.
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    const fields = await number.count().catch(() => 0);
    if (fields > 0 && (await number.isVisible().catch(() => false))) {
      break;
    }
    const cardTab = frame.getByRole("button", { name: "Card", exact: true }).first();
    if ((await cardTab.count().catch(() => 0)) > 0) {
      await cardTab.click().catch(() => {});
    }
    await page.waitForTimeout(1_000);
  }
  await number.waitFor({ state: "visible", timeout: 30_000 });
  await number.fill("4242 4242 4242 4242");

  const expiry = frame.locator('input[name="expiry"], input[autocomplete="cc-exp"]').first();
  await expiry.fill("12 / 34");

  const cvc = frame.locator('input[name="cvc"], input[autocomplete="cc-csc"]').first();
  await cvc.fill("123");

  // The Payment Element requires a billing country for a card. Selecting one
  // may reveal a postal-code field.
  const country = frame.locator('select[name="country"], select[autocomplete="country"]').first();
  if ((await country.count()) > 0) {
    await country
      .selectOption({ label: "France" })
      .catch(() => country.selectOption("FR"))
      .catch(() => {});
  }

  // Postal code appears for some billing configurations; fill it if present.
  const postal = frame.locator('input[name="postalCode"], input[autocomplete="postal-code"]').first();
  if ((await postal.count()) > 0) {
    await postal.fill("75001").catch(() => {});
  }
}

async function main() {
  const browser = await chromium.launch();
  const context = await browser.newContext({ baseURL: baseUrl });
  const page = await context.newPage();

  let orderNumber;
  let orderId;
  let paymentIntentId;
  let amountCents;
  let orderBody;

  try {
    // Sign in first: the cart is account-scoped, so it can be emptied before
    // the proof starts. This also keeps every run on a known cart state.
    await page.goto("/signin?next=/cart", { waitUntil: "domcontentloaded", timeout: 120_000 });
    await page.getByLabel("Email", { exact: true }).fill(DEMO_EMAIL);
    await page.getByLabel("Password", { exact: true }).fill(DEMO_PASSWORD);
    const signInButton = page.getByRole("button", { name: "Sign in" });
    await signInButton.waitFor({ state: "visible", timeout: 30_000 });
    let signedIn = false;
    for (let attempt = 0; attempt < 5 && !signedIn; attempt += 1) {
      await signInButton.click().catch(() => {});
      signedIn = await page
        .waitForURL((url) => url.pathname === "/cart", { timeout: 20_000 })
        .then(() => true)
        .catch(() => false);
    }
    assert(signedIn, "sign-in never reached /cart");
    await emptyCart(page);

    const product = chooseProduct();
    console.log(`[proof] paying for ${product.slug} (variant never ordered before)`);
    await page.goto(`/p/${product.slug}`, { waitUntil: "domcontentloaded", timeout: 120_000 });
    await page.getByRole("heading", { name: product.title, level: 1 }).waitFor({ timeout: 60_000 });
    const addButton = page.getByRole("button", { name: "Add to cart" });
    await addButton.waitFor({ state: "visible", timeout: 30_000 });
    // A server-rendered button is clickable before React hydrates it. Retry
    // until the action actually runs; a cold free instance can be slow.
    let added = false;
    for (let attempt = 0; attempt < 6 && !added; attempt += 1) {
      await addButton.click();
      added = await page
        .getByText("Added to cart.")
        .waitFor({ timeout: 5_000 })
        .then(() => true)
        .catch(() => false);
    }
    assert(added, "the add-to-cart action never confirmed");
    await page.getByRole("link", { name: "View cart" }).click();
    await page.waitForURL((url) => url.pathname === "/cart");

    const cart = await priceInBrowser(page);

    await page.getByRole("link", { name: "Continue to checkout" }).click();
    await page.waitForURL((url) => url.pathname === "/checkout", { timeout: 60_000 });
    await page.getByRole("heading", { name: "Checkout", level: 1 }).waitFor();

    const keyHit = await waitFor(
      "the pk_test_ publishable key in a client chunk",
      () => findPublishableKey(page),
      30_000,
      1_000,
    );
    assert(keyHit !== null, "the checkout bundle carries no pk_test_ publishable key");
    console.log(`[proof] publishable key ${maskKey(keyHit.key)} inlined in ${new URL(keyHit.src).pathname}`);
    console.log(`[proof] cart rendered subtotal=${cart.subtotal} total=${cart.total}`);

    for (let attempt = 0; attempt < 10 && orderBody === undefined; attempt += 1) {
      const [response] = await Promise.all([
        page.waitForResponse(
          (candidate) =>
            new URL(candidate.url()).pathname === "/api/checkout" &&
            candidate.request().method() === "POST",
          { timeout: 90_000 },
        ),
        page.getByRole("button", { name: "Place order" }).click(),
      ]);
      const body = await response.json();

      if (response.status() === 201) {
        orderBody = body;
        break;
      }

      if (
        response.status() === 200 &&
        typeof body.number === "string" &&
        typeof body.clientSecret !== "string"
      ) {
        throw new Error(
          `cart version replayed order ${body.number}; chooseProduct must avoid ordered variants`,
        );
      }

      throw new Error(`checkout returned ${response.status()}: ${JSON.stringify(body)}`);
    }

    assert(orderBody !== undefined, "checkout never created a fresh order");
    assert(orderBody.status === "PENDING", `order status was ${orderBody.status}`);
    assert(typeof orderBody.number === "string", "checkout returned no order number");
    assert(typeof orderBody.paymentIntentId === "string", "checkout returned no intent id");
    assert(typeof orderBody.totalCents === "number", "checkout returned no integer total");
    assert(orderBody.paymentIntentId.startsWith("pi_"), "intent id is not a Stripe id");

    orderNumber = safeNumber(orderBody.number);
    orderId = safeUuid(orderBody.order.id);
    paymentIntentId = orderBody.paymentIntentId;
    amountCents = orderBody.totalCents;

    console.log(
      `[proof] checkout -> 201 order=${orderNumber} status=PENDING totalCents=${amountCents} pi=${paymentIntentId}`,
    );

    await page.getByRole("heading", { name: `Pay for ${orderNumber}` }).waitFor({ timeout: 60_000 });
    await fillPaymentElement(page);
    console.log("[proof] Payment Element mounted and accepted test card input");

    // The Pay button sits below a tall Payment Element. Scroll it into view;
    // if the click still does not submit, requestSubmit is the same action as
    // pressing Enter and runs the form's onSubmit (stripe.confirmPayment).
    const payButton = page.getByRole("button", { name: /^Pay / });
    await payButton.scrollIntoViewIfNeeded();
    await payButton.click();
    await page.waitForTimeout(2_000);
    const stillUnsubmitted = await payButton
      .innerText()
      .then((text) => text.toLowerCase().startsWith("pay "))
      .catch(() => false);
    if (stillUnsubmitted) {
      await page.locator("form").last().evaluate((form) => form.requestSubmit());
    }

    await page.waitForURL((url) => url.pathname === `/orders/${orderNumber}`, { timeout: 120_000 });
    console.log("[proof] Stripe confirmPayment redirected to the order page");
  } finally {
    await browser.close();
  }

  // The webhook is asynchronous. Poll the database until the signed delivery
  // has moved the order out of PENDING.
  const before = await waitFor("order to become PAID", async () => {
    const row = psql(
      `SELECT status, "paidAt", "totalCents", "paymentIntentId" FROM "Order" WHERE id = '${orderId}'`,
    );
    if (row.length === 0) {
      return null;
    }
    const [status, paidAt, totalCents, intentId] = row.split("|");
    return status === "PAID" ? { status, paidAt, totalCents: Number(totalCents), intentId } : null;
  });
  assert(before.totalCents === amountCents, `order total ${before.totalCents} != checkout ${amountCents}`);
  assert(before.intentId === paymentIntentId, "order is bound to a different PaymentIntent");
  console.log(
    `[proof] Neon order=${orderNumber} status=PAID paidAt=${before.paidAt} totalCents=${before.totalCents}`,
  );

  const intent = await stripe.paymentIntents.retrieve(paymentIntentId);
  assert(intent.status === "succeeded", `intent status ${intent.status}`);
  assert(intent.amount === amountCents, `intent amount ${intent.amount} != server total ${amountCents}`);
  assert(intent.currency === "eur", `intent currency ${intent.currency}`);
  assert(intent.metadata?.orderId === orderId, "intent metadata.orderId does not match");
  assert(intent.metadata?.orderNumber === orderNumber, "intent metadata.orderNumber does not match");
  console.log(
    `[proof] Stripe intent=${intent.id} status=${intent.status} amount=${intent.amount} currency=${intent.currency} metadata.orderNumber=${intent.metadata.orderNumber}`,
  );

  // Exactly one intent for the order. Search is eventually consistent, so retry
  // briefly; fall back to scanning the most recent intents if search is not
  // available on the account.
  const intents = await waitFor(
    "the order to have exactly one PaymentIntent",
    async () => {
      try {
        const found = await stripe.paymentIntents.search({
          query: `metadata['orderId']:'${orderId}'`,
          limit: 10,
        });
        if (found.data.length >= 1) {
          return found.data;
        }
      } catch {
        const recent = await stripe.paymentIntents.list({ limit: 100 });
        const matching = recent.data.filter((candidate) => candidate.metadata?.orderId === orderId);
        if (matching.length >= 1) {
          return matching;
        }
      }
      return null;
    },
    60_000,
  );
  assert(intents.length === 1, `expected exactly one intent for the order, found ${intents.length}`);
  assert(intents[0].id === paymentIntentId, "the single intent is not the order's intent");
  console.log(`[proof] PaymentIntents for order=${orderNumber}: ${intents.length}`);

  // Find the event Stripe delivered for this intent. `pending_webhooks=0`
  // means every subscribed endpoint, including the deployed store, answered.
  const event = await waitFor(
    "the payment_intent.succeeded event",
    async () => {
      const events = await stripe.events.list({ type: "payment_intent.succeeded", limit: 30 });
      return (
        events.data.find(
          (candidate) =>
            candidate.data?.object &&
            candidate.data.object.id === paymentIntentId &&
            candidate.type === "payment_intent.succeeded",
        ) ?? null
      );
    },
    60_000,
  );
  assert(event.pending_webhooks === 0, `event still has ${event.pending_webhooks} pending webhooks`);
  console.log(
    `[proof] webhook event=${event.id} type=${event.type} pending_webhooks=${event.pending_webhooks}`,
  );

  // Replay the exact event body with a fresh valid signature. The route must
  // answer 200 and the unique eventId must roll the transaction back.
  const rawBody = JSON.stringify(event);
  const signature = Stripe.webhooks.generateTestHeaderString({
    payload: rawBody,
    secret: webhookSecret,
  });
  const replay = await fetch(`${baseUrl}/api/webhooks/payments`, {
    method: "POST",
    headers: { "content-type": "application/json", "stripe-signature": signature },
    body: rawBody,
  });
  const replayBody = await replay.json().catch(() => null);
  const eventId = safeEventId(event.id);
  const rows = Number(psql(`SELECT count(*) FROM "WebhookEvent" WHERE "eventId" = '${eventId}'`));
  const after = psql(
    `SELECT status, "paidAt" FROM "Order" WHERE id = '${orderId}'`,
  ).split("|");

  assert(replay.status === 200, `replay returned ${replay.status}`);
  assert(replayBody?.action === "duplicate", `replay action was ${JSON.stringify(replayBody?.action)}`);
  assert(rows === 1, `expected one WebhookEvent row, found ${rows}`);
  assert(after[0] === "PAID", `replay changed the order status to ${after[0]}`);
  assert(after[1] === before.paidAt, "replay moved paidAt");

  console.log(
    `[proof] replay -> HTTP ${replay.status} ${JSON.stringify(replayBody)}; WebhookEvent rows=${rows}; order=${after[0]} paidAt unchanged`,
  );

  console.log(
    `[proof] PASS url=${baseUrl} order=${orderNumber} pi=${paymentIntentId} amountCents=${amountCents} event=${eventId}`,
  );
}

try {
  await main();
} catch (error) {
  console.error(`[fail] ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
