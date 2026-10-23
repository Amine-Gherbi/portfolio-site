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

// Forged price: the request carries `totalCents: 1` (and a fake unit price and
// currency). None of it is read. The order and the PaymentIntent must both be
// for the amount derived from `Variant.priceCents`.

const UNIT_PRICE = 2_500;
const QUANTITY = 2;
const EXPECTED_TOTAL = UNIT_PRICE * QUANTITY;

let catalog: CatalogFixture;
let userId: string;
let cartVersion: string;

beforeAll(async () => {
  runMigrations();
  catalog = await createCatalog({
    stock: 5,
    priceCents: UNIT_PRICE,
    label: "forged-price",
  });
  const users = await createUsers("forged-price", 1);
  const first = users[0];
  if (first === undefined) {
    throw new Error("no user fixture");
  }
  userId = first;

  const cart = await createCart(userId, [
    { variantId: catalog.variantId, quantity: QUANTITY },
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

describe("client-forged total", () => {
  it("ignores every monetary field in the body", async () => {
    const response = await withUser(userId, () =>
      POST(
        checkoutRequest(
          {
            addressId: randomUUID(),
            cartVersion,
            // Everything below is a lie the server must not read.
            totalCents: 1,
            subtotalCents: 1,
            discountCents: 9_999,
            currency: "eur",
            items: [
              {
                variantId: catalog.variantId,
                quantity: QUANTITY,
                unitPriceCents: 0,
              },
            ],
          },
          "203.0.113.21",
        ),
      ),
    );

    const { status, body } = await readCheckout(response);
    expect(status).toBe(201);
    expect(body.totalCents).toBe(EXPECTED_TOTAL);
    expect(body.subtotalCents).toBe(EXPECTED_TOTAL);
    expect(body.discountCents).toBe(0);
    expect(body.currency).toBe("usd");
    expect(body.paymentIntent?.amountCents).toBe(EXPECTED_TOTAL);

    const orderId = body.orderId;
    if (orderId === undefined) {
      throw new Error("no order id in response");
    }

    const order = await db.order.findUnique({
      where: { id: orderId },
      select: {
        subtotalCents: true,
        discountCents: true,
        totalCents: true,
        currency: true,
        items: { select: { unitPriceCents: true, quantity: true } },
      },
    });
    expect(order).not.toBeNull();
    expect(order?.subtotalCents).toBe(EXPECTED_TOTAL);
    expect(order?.totalCents).toBe(EXPECTED_TOTAL);
    expect(order?.discountCents).toBe(0);
    expect(order?.currency).toBe("usd");
    expect(order?.items).toHaveLength(1);
    expect(order?.items[0]?.unitPriceCents).toBe(UNIT_PRICE);
    expect(order?.items[0]?.quantity).toBe(QUANTITY);

    // The amount actually handed to the payment provider is the recomputed
    // one. With a live test key, ask Stripe rather than trusting our echo.
    const key = process.env.STRIPE_SECRET_KEY;
    const intentId = body.paymentIntent?.id;
    if (key !== undefined && key.length > 0) {
      if (intentId === undefined) {
        throw new Error("no payment intent id in response");
      }
      const intent = await new Stripe(key).paymentIntents.retrieve(intentId);
      expect(intent.amount).toBe(EXPECTED_TOTAL);
      expect(intent.currency).toBe("usd");
    }
  });
});
