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

// Stripe retries. The same event id delivered twice must apply its side effect
// once and answer 200 both times. The primary key on WebhookEvent is the guard,
// and it lives in the same transaction as the order update.

const previousSecret = process.env.STRIPE_WEBHOOK_SECRET;

let catalog: CatalogFixture;
let userId: string;
const eventIds: string[] = [];

beforeAll(async () => {
  process.env.STRIPE_WEBHOOK_SECRET = WEBHOOK_SECRET;
  runMigrations();
  catalog = await createCatalog({
    stock: 10,
    priceCents: 4_200,
    label: "replay",
  });
  const users = await createUsers("replay", 1);
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

describe("webhook replay", () => {
  it("applies a duplicate event id as a 200 no-op", async () => {
    const pending = await createPendingOrder(userId, catalog.variantId, 1);
    const eventId = newEventId();
    eventIds.push(eventId);

    const event = paymentSucceededEvent({
      eventId,
      paymentIntentId: pending.paymentIntentId,
      amountCents: pending.totalCents,
    });

    const firstResponse = await POST(signedEventRequest(event));
    const first = await readWebhook(firstResponse);
    expect(first.status).toBe(200);
    expect(first.body.action).toBe("processed");

    const afterFirst = await db.order.findUnique({
      where: { id: pending.orderId },
      select: { status: true, updatedAt: true },
    });
    expect(afterFirst?.status).toBe("PAID");

    // Re-delivery of the identical event.
    const secondResponse = await POST(signedEventRequest(event));
    const second = await readWebhook(secondResponse);
    expect(second.status).toBe(200);
    expect(second.body.action).toBe("duplicate");
    expect(second.body.error).toBeUndefined();

    // One event row, one transition, and no second release of stock.
    const eventRows = await db.webhookEvent.count({
      where: { stripeEventId: eventId },
    });
    expect(eventRows).toBe(1);

    const afterSecond = await db.order.findUnique({
      where: { id: pending.orderId },
      select: { status: true, updatedAt: true },
    });
    expect(afterSecond?.status).toBe("PAID");
    expect(afterSecond?.updatedAt.getTime()).toBe(
      afterFirst?.updatedAt.getTime(),
    );

    const reservation = await db.stockReservation.findFirst({
      where: { orderId: pending.orderId },
      select: { releasedAt: true },
    });
    expect(reservation?.releasedAt).toBeNull();
  });
});
