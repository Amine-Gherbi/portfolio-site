import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { db } from "@/lib/db";
import {
  reconcilePendingOrders,
  type PaymentIntentReader,
  type PaymentIntentSnapshot,
} from "@/lib/orders";

import {
  cleanupFixture,
  createCatalog,
  createPendingOrder,
  createUsers,
  runMigrations,
  type CatalogFixture,
} from "./helpers/fixtures";

// The webhook that never arrives. A PENDING order older than two minutes is
// reconciled against the PaymentIntent Stripe actually holds: succeeded and
// fully matching becomes PAID, succeeded with a mismatch becomes
// REFUND_REQUIRED, canceled becomes CANCELLED. The job is injected with a fake
// Stripe reader, so no API key or network is involved.
//
// Idempotency is asserted, not assumed: the second run must not settle again,
// release stock again, or add another reservation row.

let catalog: CatalogFixture;
let userId: string;
const orderIds: string[] = [];

beforeAll(async () => {
  runMigrations();
  catalog = await createCatalog({
    stock: 5,
    priceCents: 6_000,
    label: "reconcile",
  });
  const users = await createUsers("reconcile", 1);
  const first = users[0];
  if (first === undefined) {
    throw new Error("no user fixture");
  }
  userId = first;
}, 120_000);

afterEach(async () => {
  if (orderIds.length > 0) {
    // Deleting a fixture reservation does not put its units back. Restore the
    // ones still held so each test starts from the catalog's declared stock.
    const held = await db.stockReservation.findMany({
      where: { orderId: { in: [...orderIds] }, releasedAt: null },
      select: { variantId: true, qty: true },
    });
    for (const reservation of held) {
      await db.variant.update({
        where: { id: reservation.variantId },
        data: { stock: { increment: reservation.qty } },
      });
    }
    await db.stockReservation.deleteMany({
      where: { orderId: { in: [...orderIds] } },
    });
    await db.orderItem.deleteMany({
      where: { orderId: { in: [...orderIds] } },
    });
    await db.order.deleteMany({ where: { id: { in: [...orderIds] } } });
    orderIds.length = 0;
  }
});

afterAll(async () => {
  await cleanupFixture({ userIds: [userId], catalogs: [catalog] });
  await db.$disconnect();
});

async function pending(quantity: number) {
  const fixture = await createPendingOrder(userId, catalog.variantId, quantity);
  orderIds.push(fixture.orderId);
  return fixture;
}

async function backdate(orderId: string): Promise<void> {
  await db.order.update({
    where: { id: orderId },
    data: { createdAt: new Date(Date.now() - 3 * 60_000) },
  });
}

function readerFor(
  snapshot: PaymentIntentSnapshot,
): { reader: PaymentIntentReader; calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    reader: {
      async retrievePaymentIntent(id: string): Promise<PaymentIntentSnapshot> {
        calls.push(id);
        return { ...snapshot, id };
      },
    },
  };
}

function succeeded(
  paymentIntentId: string,
  totalCents: number,
): PaymentIntentSnapshot {
  return {
    id: paymentIntentId,
    status: "succeeded",
    amount: totalCents,
    amount_received: totalCents,
    currency: "usd",
  };
}

async function statusOf(orderId: string): Promise<string | undefined> {
  const order = await db.order.findUnique({
    where: { id: orderId },
    select: { status: true },
  });
  return order?.status;
}

async function stock(): Promise<number> {
  const variant = await db.variant.findUnique({
    where: { id: catalog.variantId },
    select: { stock: true },
  });
  return variant?.stock ?? -1;
}

async function counts(orderId: string) {
  const [reservations, items] = await Promise.all([
    db.stockReservation.count({ where: { orderId } }),
    db.orderItem.count({ where: { orderId } }),
  ]);
  return { reservations, items };
}

describe("reconciliation for a dropped webhook", () => {
  it("settles a PENDING order with a paid PaymentIntent to PAID", async () => {
    const fixture = await pending(2);
    await backdate(fixture.orderId);

    const stockAfterCheckout = await stock();
    expect(stockAfterCheckout).toBe(3);

    const { reader, calls } = readerFor(
      succeeded(fixture.paymentIntentId, fixture.totalCents),
    );
    const summary = await reconcilePendingOrders(reader);

    expect(calls).toEqual([fixture.paymentIntentId]);
    expect(summary.scanned).toBe(1);
    expect(summary.settled).toBe(1);
    expect(summary.refundRequired).toBe(0);
    expect(summary.cancelled).toBe(0);
    expect(await statusOf(fixture.orderId)).toBe("PAID");

    // PAID keeps the reservation; the units are sold.
    const reservation = await db.stockReservation.findFirst({
      where: { orderId: fixture.orderId },
      select: { releasedAt: true },
    });
    expect(reservation?.releasedAt).toBeNull();
    expect(await stock()).toBe(stockAfterCheckout);
  }, 60_000);

  it("does not double-settle or duplicate rows on a second run", async () => {
    const fixture = await pending(2);
    await backdate(fixture.orderId);

    const reader = readerFor(
      succeeded(fixture.paymentIntentId, fixture.totalCents),
    );
    const first = await reconcilePendingOrders(reader.reader);
    expect(first.settled).toBe(1);

    const stockAfterFirst = await stock();
    const countsAfterFirst = await counts(fixture.orderId);

    const second = await reconcilePendingOrders(reader.reader);

    expect(second).toEqual({
      scanned: 0,
      settled: 0,
      refundRequired: 0,
      cancelled: 0,
      skipped: 0,
      failed: 0,
    });
    // The intent was only retrieved by the first run.
    expect(reader.calls).toHaveLength(1);
    expect(await statusOf(fixture.orderId)).toBe("PAID");
    expect(await stock()).toBe(stockAfterFirst);
    expect(await counts(fixture.orderId)).toEqual(countsAfterFirst);
  }, 60_000);

  it("settles exactly once when two runs race", async () => {
    const fixture = await pending(1);
    await backdate(fixture.orderId);

    const stockAfterCheckout = await stock();
    const one = readerFor(succeeded(fixture.paymentIntentId, fixture.totalCents));
    const two = readerFor(succeeded(fixture.paymentIntentId, fixture.totalCents));

    const [a, b] = await Promise.all([
      reconcilePendingOrders(one.reader),
      reconcilePendingOrders(two.reader),
    ]);

    expect(a.settled + b.settled).toBe(1);
    expect(await statusOf(fixture.orderId)).toBe("PAID");
    expect(await stock()).toBe(stockAfterCheckout);

    const reservations = await db.stockReservation.findMany({
      where: { orderId: fixture.orderId },
      select: { releasedAt: true },
    });
    expect(reservations).toHaveLength(1);
    expect(reservations[0]?.releasedAt).toBeNull();
  }, 60_000);

  it("sends a succeeded-but-short payment to REFUND_REQUIRED and restores stock", async () => {
    const fixture = await pending(1);
    await backdate(fixture.orderId);
    const stockBeforeCheckout = (await stock()) + 1;

    const { reader } = readerFor({
      ...succeeded(fixture.paymentIntentId, fixture.totalCents),
      amount_received: fixture.totalCents - 500,
    });
    const summary = await reconcilePendingOrders(reader);

    expect(summary.refundRequired).toBe(1);
    expect(await statusOf(fixture.orderId)).toBe("REFUND_REQUIRED");
    expect(await stock()).toBe(stockBeforeCheckout);

    const reservation = await db.stockReservation.findFirst({
      where: { orderId: fixture.orderId },
      select: { releasedAt: true },
    });
    expect(reservation?.releasedAt).not.toBeNull();
  }, 60_000);

  it("cancels a PENDING order whose PaymentIntent was canceled", async () => {
    const fixture = await pending(1);
    await backdate(fixture.orderId);
    const stockBeforeCheckout = (await stock()) + 1;

    const { reader } = readerFor({
      id: fixture.paymentIntentId,
      status: "canceled",
      amount: fixture.totalCents,
      amount_received: 0,
      currency: "usd",
    });
    const summary = await reconcilePendingOrders(reader);

    expect(summary.cancelled).toBe(1);
    expect(await statusOf(fixture.orderId)).toBe("CANCELLED");
    expect(await stock()).toBe(stockBeforeCheckout);
  }, 60_000);

  it("leaves an in-flight PaymentIntent and a recent order alone", async () => {
    const inFlight = await pending(1);
    await backdate(inFlight.orderId);

    const recent = await pending(1);
    // `recent` keeps its checkout timestamp: younger than two minutes.

    const { reader, calls } = readerFor({
      id: inFlight.paymentIntentId,
      status: "processing",
      amount: inFlight.totalCents,
      amount_received: 0,
      currency: "usd",
    });
    const summary = await reconcilePendingOrders(reader);

    expect(summary.scanned).toBe(1);
    expect(summary.skipped).toBe(1);
    expect(calls).toEqual([inFlight.paymentIntentId]);
    expect(await statusOf(inFlight.orderId)).toBe("PENDING");
    expect(await statusOf(recent.orderId)).toBe("PENDING");
  }, 60_000);
});
