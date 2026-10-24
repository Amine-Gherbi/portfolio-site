import { beforeEach, describe, expect, it } from "vitest";

import { POST as sweep } from "@/app/api/internal/sweep-reservations/route";

import { createPendingOrder, resetDatabase, testDb } from "./helpers";

async function expireReservations(orderId: string): Promise<void> {
  await testDb.stockReservation.updateMany({
    where: { orderId },
    data: { expiresAt: new Date(Date.now() - 60_000) },
  });
}

beforeEach(async () => {
  await resetDatabase();
});

function sweepRequest(): Request {
  return new Request("http://localhost/api/internal/sweep-reservations", {
    method: "POST",
  });
}

describe("reservation sweeper", () => {
  it("cancels an expired PENDING order and restores the reserved stock once", async () => {
    const { order, variantId, initialStock } = await createPendingOrder({
      stock: 5,
      quantity: 2,
    });

    const reserved = await testDb.variant.findUniqueOrThrow({
      where: { id: variantId },
      select: { stock: true },
    });
    expect(reserved.stock).toBe(initialStock - 2);

    await expireReservations(order.id);

    const response = await sweep(sweepRequest());
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      cancelledOrders: 1,
      releasedReservations: 1,
    });

    const after = await testDb.order.findUniqueOrThrow({
      where: { id: order.id },
      select: { status: true },
    });
    expect(after.status).toBe("CANCELLED");

    const stockAfter = await testDb.variant.findUniqueOrThrow({
      where: { id: variantId },
      select: { stock: true },
    });
    expect(stockAfter.stock).toBe(initialStock);

    const reservation = await testDb.stockReservation.findFirstOrThrow({
      where: { orderId: order.id },
      select: { releasedAt: true },
    });
    expect(reservation.releasedAt).not.toBeNull();

    // Running again must not add the units a second time.
    const second = await sweep(sweepRequest());
    expect(second.status).toBe(200);
    expect(await second.json()).toMatchObject({
      cancelledOrders: 0,
      releasedReservations: 0,
    });

    const stockFinal = await testDb.variant.findUniqueOrThrow({
      where: { id: variantId },
      select: { stock: true },
    });
    expect(stockFinal.stock).toBe(initialStock);
  });

  it("leaves a PAID order and its stock alone even if the reservation is stale", async () => {
    const { order, variantId, initialStock } = await createPendingOrder({
      stock: 5,
      quantity: 2,
    });

    await testDb.order.update({
      where: { id: order.id },
      data: { status: "PAID", paidAt: new Date() },
    });
    await expireReservations(order.id);

    const response = await sweep(sweepRequest());
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      cancelledOrders: 0,
      releasedReservations: 0,
    });

    const after = await testDb.order.findUniqueOrThrow({
      where: { id: order.id },
      select: { status: true },
    });
    expect(after.status).toBe("PAID");

    const stock = await testDb.variant.findUniqueOrThrow({
      where: { id: variantId },
      select: { stock: true },
    });
    expect(stock.stock).toBe(initialStock - 2);

    const reservation = await testDb.stockReservation.findFirstOrThrow({
      where: { orderId: order.id },
      select: { releasedAt: true },
    });
    expect(reservation.releasedAt).toBeNull();
  });

  it("does not touch a reservation that has not expired", async () => {
    const { order } = await createPendingOrder({ stock: 5, quantity: 1 });

    const response = await sweep(sweepRequest());
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      cancelledOrders: 0,
      releasedReservations: 0,
    });

    const after = await testDb.order.findUniqueOrThrow({
      where: { id: order.id },
      select: { status: true },
    });
    expect(after.status).toBe("PENDING");
  });
});
