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

describe("payment webhook replay", () => {
  it("moves PENDING to PAID, then answers the same event with 200 and one event row", async () => {
    const { order, initialStock } = await createPendingOrder({ stock: 5 });
    const eventId = `evt_${randomUUID()}`;
    const rawBody = paymentEvent(order, eventId);

    const first = await POST(signedRequest(rawBody));
    expect(first.status).toBe(200);
    expect(await first.json()).toMatchObject({ action: "paid" });

    const paid = await testDb.order.findUniqueOrThrow({
      where: { id: order.id },
      select: { status: true, paidAt: true },
    });
    expect(paid.status).toBe("PAID");
    expect(paid.paidAt).not.toBeNull();

    const reservation = await testDb.stockReservation.findFirstOrThrow({
      where: { orderId: order.id },
      select: { releasedAt: true },
    });
    expect(reservation.releasedAt).toBeNull();

    const stock = await testDb.variant.findFirstOrThrow({
      where: { orderItems: { some: { orderId: order.id } } },
      select: { stock: true },
    });
    expect(stock.stock).toBe(initialStock - 1);

    const replay = await POST(signedRequest(rawBody));
    expect(replay.status).toBe(200);
    expect(await replay.json()).toMatchObject({ action: "duplicate" });

    expect(
      await testDb.webhookEvent.count({ where: { eventId } }),
    ).toBe(1);
    expect(
      await testDb.order.findUniqueOrThrow({
        where: { id: order.id },
        select: { status: true },
      }),
    ).toEqual({ status: "PAID" });
  });
});
