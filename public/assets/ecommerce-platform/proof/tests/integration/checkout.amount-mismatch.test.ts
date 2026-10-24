import { randomUUID } from "node:crypto";

import { beforeEach, describe, expect, it } from "vitest";

import { POST } from "@/app/api/webhooks/payments/route";

import {
  createPendingOrder,
  paymentEvent,
  resetDatabase,
  signedRequest,
  testDb,
} from "./helpers";

beforeEach(async () => {
  await resetDatabase();
});

describe("payment amount and currency checks", () => {
  it("sends a mismatched amount to REFUND_REQUIRED, never PAID, and returns stock", async () => {
    const { order, initialStock } = await createPendingOrder({ stock: 5 });
    const rawBody = paymentEvent(order, `evt_${randomUUID()}`, {
      amountCents: order.totalCents + 1,
    });

    const response = await POST(signedRequest(rawBody));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ action: "refund_required" });

    const stored = await testDb.order.findUniqueOrThrow({
      where: { id: order.id },
      select: { status: true, paidAt: true },
    });
    expect(stored.status).toBe("REFUND_REQUIRED");
    expect(stored.paidAt).toBeNull();

    const stock = await testDb.variant.findFirstOrThrow({
      where: { orderItems: { some: { orderId: order.id } } },
      select: { stock: true },
    });
    expect(stock.stock).toBe(initialStock);

    const reservation = await testDb.stockReservation.findFirstOrThrow({
      where: { orderId: order.id },
      select: { releasedAt: true },
    });
    expect(reservation.releasedAt).not.toBeNull();
  });

  it("treats a currency mismatch the same way", async () => {
    const { order } = await createPendingOrder();
    const rawBody = paymentEvent(order, `evt_${randomUUID()}`, {
      currency: "usd",
    });

    const response = await POST(signedRequest(rawBody));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ action: "refund_required" });

    const stored = await testDb.order.findUniqueOrThrow({
      where: { id: order.id },
      select: { status: true },
    });
    expect(stored.status).toBe("REFUND_REQUIRED");
  });
});
