import { randomUUID } from "node:crypto";

import Stripe from "stripe";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/auth", async () => {
  const { sessionStorage } = await import("./helpers/session");
  return {
    auth: async () => {
      const store = sessionStorage.getStore();
      return store === undefined ? null : { user: { id: store.userId } };
    },
  };
});

import { POST } from "@/app/api/checkout/route";
import { db } from "@/lib/db";
import { resetRateLimit } from "@/lib/rate-limit";

import {
  cleanupFixture,
  createCart,
  createCatalog,
  createUsers,
  runMigrations,
  type CatalogFixture,
} from "./helpers/fixtures";
import { checkoutRequest, readCheckout } from "./helpers/http";
import { withUser } from "./helpers/session";

// Double submit: the customer clicks Pay twice (or the browser retries).
// Two requests carry the same cart and the same cart version, therefore the
// same idempotency key. The unique index decides; both callers must receive
// the same order and the same client secret.

let catalog: CatalogFixture;
let userId: string;
let cartVersion: string;

beforeAll(async () => {
  runMigrations();
  catalog = await createCatalog({
    stock: 10,
    priceCents: 1_500,
    label: "double-submit",
  });
  const users = await createUsers("double-submit", 1);
  const first = users[0];
  if (first === undefined) {
    throw new Error("no user fixture");
  }
  userId = first;

  const cart = await createCart(userId, [
    { variantId: catalog.variantId, quantity: 2 },
  ]);
  cartVersion = cart.cartVersion;
}, 120_000);

beforeEach(() => {
  resetRateLimit();
});

afterAll(async () => {
  await cleanupFixture({ userIds: [userId], catalogs: [catalog] });
  await db.$disconnect();
});

describe("concurrent double submit", () => {
  it("creates one order and returns one client secret to both callers", async () => {
    const body = { addressId: randomUUID(), cartVersion };

    const [firstResponse, secondResponse] = await Promise.all([
      withUser(userId, () =>
        POST(checkoutRequest(body, "203.0.113.7")),
      ),
      withUser(userId, () =>
        POST(checkoutRequest(body, "203.0.113.7")),
      ),
    ]);

    const first = await readCheckout(firstResponse);
    const second = await readCheckout(secondResponse);

    expect([first.status, second.status].sort()).toEqual([200, 201]);
    expect(first.body.orderId).toBe(second.body.orderId);
    expect(first.body.orderId).toBeDefined();

    // Identical secret, not merely two non-null secrets.
    expect(first.body.paymentIntent?.clientSecret).toBeTruthy();
    expect(first.body.paymentIntent?.clientSecret).toBe(
      second.body.paymentIntent?.clientSecret,
    );
    expect(first.body.paymentIntent?.id).toBe(
      second.body.paymentIntent?.id,
    );

    const orders = await db.order.findMany({
      where: { userId },
      select: { id: true, totalCents: true, stripePaymentIntentId: true },
    });
    expect(orders).toHaveLength(1);
    expect(orders[0]?.totalCents).toBe(3_000);
    expect(orders[0]?.stripePaymentIntentId).toBe(
      first.body.paymentIntent?.id,
    );

    const orderId = orders[0]?.id;
    expect(orderId).toBeDefined();
    const reservations = await db.stockReservation.findMany({
      where: { orderId: orderId ?? "" },
      select: { qty: true },
    });
    expect(reservations).toHaveLength(1);
    expect(reservations[0]?.qty).toBe(2);

    // Stock was decremented once, not twice.
    const variant = await db.variant.findUnique({
      where: { id: catalog.variantId },
      select: { stock: true },
    });
    expect(variant?.stock).toBe(8);

    // The live assertion needs a real test-mode key: with one, the persisted
    // intent is retrieved from Stripe and its amount checked. Without one the
    // suite is honest about what it did not prove.
    const key = process.env.STRIPE_SECRET_KEY;
    if (key === undefined || key.length === 0) {
      console.log("BLOCKED: no Stripe test key");
    } else {
      const stripe = new Stripe(key);
      const intentId = first.body.paymentIntent?.id;
      if (intentId === undefined) {
        throw new Error("no payment intent id in response");
      }
      const intent = await stripe.paymentIntents.retrieve(intentId);
      expect(intent.amount).toBe(3_000);
      expect(intent.currency).toBe("usd");
    }
  });
});
