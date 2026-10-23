import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { POST } from "@/app/api/webhooks/stripe/route";
import { db } from "@/lib/db";

import {
  cleanupFixture,
  createCatalog,
  createPendingOrder,
  createUsers,
  runMigrations,
  type CatalogFixture,
} from "./helpers/fixtures";
import { readWebhook } from "./helpers/http";
import {
  WEBHOOK_SECRET,
  newEventId,
  paymentSucceededEvent,
  signedEventRequest,
} from "./helpers/webhooks";

// Amount mismatch: Stripe says it received a different amount (or currency)
// than the order stores. Money that does not agree is never promoted to PAID;
// it becomes REFUND_REQUIRED, and the reserved units go back on the shelf.

const UNIT_PRICE = 5_000;
const previousSecret = process.env.STRIPE_WEBHOOK_SECRET;

let catalog: CatalogFixture;
let userId: string;
const eventIds: string[] = [];

beforeAll(async () => {
  process.env.STRIPE_WEBHOOK_SECRET = WEBHOOK_SECRET;
  runMigrations();
  catalog = await createCatalog({
    stock: 20,
    priceCents: UNIT_PRICE,
    label: "amount-mismatch",
  });
  const users = await createUsers("amount-mismatch", 1);
  const first = users[0];
  if (first === undefined) {
    throw new Error("no user fixture");
  }
  userId = first;
}, 120_000);

afterAll(async () => {
  await cleanupFixture({
    userIds: [userId],
    catalogs: [catalog],
    webhookEventIds: eventIds,
  });
  if (previousSecret === undefined) {
    delete process.env.STRIPE_WEBHOOK_SECRET;
  } else {
    process.env.STRIPE_WEBHOOK_SECRET = previousSecret;
  }
  await db.$disconnect();
});

async function orderNumber(orderId: string) {
  const order = await db.order.findUnique({
    where: { id: orderId },
    select: { status: true, totalCents: true },
  });
  return order;
}

describe("webhook amount verification", () => {
  it("accepts a matching amount and leaves the reservation open", async () => {
    const pending = await createPendingOrder(userId, catalog.variantId, 1);
    const eventId = newEventId();
    eventIds.push(eventId);

    const response = await POST(
      signedEventRequest(
        paymentSucceededEvent({
          eventId,
          paymentIntentId: pending.paymentIntentId,
          amountCents: pending.totalCents,
        }),
      ),
    );

    const { status, body } = await readWebhook(response);
    expect(status).toBe(200);
    expect(body.action).toBe("processed");
    expect((await orderNumber(pending.orderId))?.status).toBe("PAID");

    const reservation = await db.stockReservation.findFirst({
      where: { orderId: pending.orderId },
      select: { releasedAt: true },
    });
    expect(reservation?.releasedAt).toBeNull();
  });

  it("sends a short payment to REFUND_REQUIRED and returns the stock", async () => {
    const stockBefore = await db.variant.findUnique({
      where: { id: catalog.variantId },
      select: { stock: true },
    });
    const pending = await createPendingOrder(userId, catalog.variantId, 1);
    const eventId = newEventId();
    eventIds.push(eventId);

    const response = await POST(
      signedEventRequest(
        paymentSucceededEvent({
          eventId,
          paymentIntentId: pending.paymentIntentId,
          amountCents: pending.totalCents,
          amountReceivedCents: pending.totalCents - 1_000,
        }),
      ),
    );

    const { status, body } = await readWebhook(response);
    expect(status).toBe(200);
    expect(body.action).toBe("processed");
    expect((await orderNumber(pending.orderId))?.status).toBe(
      "REFUND_REQUIRED",
    );

    const reservation = await db.stockReservation.findFirst({
      where: { orderId: pending.orderId },
      select: { releasedAt: true, qty: true },
    });
    expect(reservation?.releasedAt).not.toBeNull();

    const variant = await db.variant.findUnique({
      where: { id: catalog.variantId },
      select: { stock: true },
    });
    // Checkout took one unit; the refund required transition put it back.
    expect(variant?.stock).toBe(stockBefore?.stock);
  });

  it("treats a currency mismatch as an amount mismatch", async () => {
    const pending = await createPendingOrder(userId, catalog.variantId, 1);
    const eventId = newEventId();
    eventIds.push(eventId);

    const response = await POST(
      signedEventRequest(
        paymentSucceededEvent({
          eventId,
          paymentIntentId: pending.paymentIntentId,
          amountCents: pending.totalCents,
          currency: "eur",
        }),
      ),
    );

    expect((await readWebhook(response)).status).toBe(200);
    expect((await orderNumber(pending.orderId))?.status).toBe(
      "REFUND_REQUIRED",
    );
  });
});
