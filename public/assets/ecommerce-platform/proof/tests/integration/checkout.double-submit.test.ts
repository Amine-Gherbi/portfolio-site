import { beforeEach, describe, expect, it } from "vitest";

import { placeOrder } from "@/lib/checkout";

import {
  createOrderAttempt,
  createVariant,
  resetDatabase,
  testDb,
} from "./helpers";

beforeEach(async () => {
  await resetDatabase();
});

describe("double submit of one cart version", () => {
  it("creates one order and answers the replay with that same order", async () => {
    const { variantId } = await createVariant({
      priceCents: 2_900,
      stock: 10,
    });
    const attempt = await createOrderAttempt({ variantId });

    const [first, second] = await Promise.all([
      placeOrder(attempt),
      placeOrder(attempt),
    ]);

    // Either call may win the race; only the set of outcomes is fixed.
    expect([first.kind, second.kind].sort()).toEqual(["created", "duplicate"]);

    const created =
      first.kind === "created" ? first : second.kind === "created" ? second : null;
    const duplicate =
      first.kind === "duplicate" ? first : second.kind === "duplicate" ? second : null;

    if (created === null || duplicate === null) {
      throw new Error("unexpected result kinds");
    }

    expect(duplicate.order.id).toBe(created.order.id);
    expect(duplicate.order.number).toBe(created.order.number);
    expect(duplicate.order.totalCents).toBe(created.order.totalCents);

    const orders = await testDb.order.count({
      where: { userId: attempt.userId },
    });
    const stock = await testDb.variant.findUniqueOrThrow({
      where: { id: variantId },
      select: { stock: true },
    });

    expect(orders).toBe(1);
    expect(stock.stock).toBe(9);
  });
});
