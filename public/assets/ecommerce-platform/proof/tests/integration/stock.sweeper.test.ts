import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { db } from "@/lib/db";
import { sweepExpiredReservations } from "@/lib/reservations";

import {
  cleanupFixture,
  createCatalog,
  createPendingOrder,
  createUsers,
  runMigrations,
  type CatalogFixture,
} from "./helpers/fixtures";

// The sweeper is the answer to "the customer closed the tab". It may release
// exactly the reservations that expired on a PENDING order — no more, no less
// — cancel those orders, and put the units back. A reservation on a PAID order
// is the audit trail of a sale and must never be released by a timer.

let catalog: CatalogFixture;
let userId: string;

beforeAll(async () => {
  runMigrations();
  catalog = await createCatalog({
    stock: 10,
    priceCents: 4_000,
    label: "sweeper",
  });
  const users = await createUsers("sweeper", 1);
  const first = users[0];
  if (first === undefined) {
    throw new Error("no user fixture");
  }
  userId = first;
}, 120_000);

afterAll(async () => {
  await cleanupFixture({ userIds: [userId], catalogs: [catalog] });
  await db.$disconnect();
});

async function expire(orderId: string, at: Date): Promise<void> {
  await db.stockReservation.updateMany({
    where: { orderId },
    data: { expiresAt: at },
  });
}

async function statusOf(orderId: string): Promise<string | undefined> {
  const order = await db.order.findUnique({
    where: { id: orderId },
    select: { status: true },
  });
  return order?.status;
}

async function reservationOf(orderId: string) {
  return db.stockReservation.findFirst({
    where: { orderId },
    select: { id: true, releasedAt: true, qty: true },
  });
}

async function stock(): Promise<number> {
  const variant = await db.variant.findUnique({
    where: { id: catalog.variantId },
    select: { stock: true },
  });
  return variant?.stock ?? -1;
}

describe("reservation sweeper", () => {
  it("releases exactly the expired reservations, cancels their orders and restores stock", async () => {
    const now = new Date();
    const past = new Date(now.getTime() - 60_000);
    const future = new Date(now.getTime() + 30 * 60_000);

    // Two expired PENDING orders, one live PENDING order, and one PAID order
    // whose reservation is also past its expiry. Only the first two move.
    const expired = await createPendingOrder(userId, catalog.variantId, 2);
    const expiredSecond = await createPendingOrder(userId, catalog.variantId, 1);
    const live = await createPendingOrder(userId, catalog.variantId, 1);
    const paid = await createPendingOrder(userId, catalog.variantId, 1);

    await expire(expired.orderId, past);
    await expire(expiredSecond.orderId, past);
    await expire(live.orderId, future);
    await expire(paid.orderId, past);
    await db.order.update({
      where: { id: paid.orderId },
      data: { status: "PAID" },
    });

    const stockBefore = await stock();
    expect(stockBefore).toBe(10 - 2 - 1 - 1 - 1);

    const summary = await sweepExpiredReservations(now);

    expect(summary).toEqual({
      ordersCancelled: 2,
      reservationsReleased: 2,
      unitsRestored: 3,
      skipped: 0,
    });

    expect(await statusOf(expired.orderId)).toBe("CANCELLED");
    expect(await statusOf(expiredSecond.orderId)).toBe("CANCELLED");
    expect(await statusOf(live.orderId)).toBe("PENDING");
    expect(await statusOf(paid.orderId)).toBe("PAID");

    expect((await reservationOf(expired.orderId))?.releasedAt).not.toBeNull();
    expect(
      (await reservationOf(expiredSecond.orderId))?.releasedAt,
    ).not.toBeNull();
    expect((await reservationOf(live.orderId))?.releasedAt).toBeNull();
    // PAID keeps its reservation: the units are sold, not abandoned.
    expect((await reservationOf(paid.orderId))?.releasedAt).toBeNull();

    // 10 - the live order (1) - the paid order (1).
    expect(await stock()).toBe(8);
  }, 60_000);

  it("is idempotent: a second run changes nothing", async () => {
    const before = await stock();
    const summary = await sweepExpiredReservations(new Date());

    expect(summary).toEqual({
      ordersCancelled: 0,
      reservationsReleased: 0,
      unitsRestored: 0,
      skipped: 0,
    });
    expect(await stock()).toBe(before);
  }, 60_000);

  it("leaves an expired reservation on an order that is no longer PENDING", async () => {
    const now = new Date();
    const pending = await createPendingOrder(userId, catalog.variantId, 1);
    await expire(pending.orderId, new Date(now.getTime() - 60_000));

    const stockAfterCheckout = await stock();

    // A webhook already settled the order while its reservation was past its
    // expiry. The scan excludes non-PENDING orders, and the CAS inside the
    // transaction would refuse anyway; either way the sale keeps its units.
    await db.order.update({
      where: { id: pending.orderId },
      data: { status: "PAID" },
    });

    const summary = await sweepExpiredReservations(now);

    expect(summary.ordersCancelled).toBe(0);
    expect(summary.reservationsReleased).toBe(0);
    expect(await statusOf(pending.orderId)).toBe("PAID");
    expect((await reservationOf(pending.orderId))?.releasedAt).toBeNull();
    expect(await stock()).toBe(stockAfterCheckout);
  }, 60_000);
});
