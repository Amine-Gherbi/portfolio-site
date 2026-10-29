import { beforeEach, describe, expect, it } from "vitest";

import {
  createOrderAttempt,
  createVariant,
  placeOrderForTest,
  resetDatabase,
  testDb,
} from "./helpers";

beforeEach(async () => {
  await resetDatabase();
});

describe("20 concurrent checkouts against stock 5", () => {
  it("accepts exactly five orders, leaves stock at zero and five open reservations", async () => {
    const { variantId } = await createVariant({ priceCents: 1_999, stock: 5 });

    const attempts = [];
    for (let index = 0; index < 20; index += 1) {
      attempts.push(await createOrderAttempt({ variantId }));
    }

    const results = await Promise.all(
      attempts.map((attempt) => placeOrderForTest(attempt)),
    );

    const created = results.filter((result) => result.kind === "created");
    const outOfStock = results.filter(
      (result) => result.kind === "out_of_stock",
    );

    const variant = await testDb.variant.findUniqueOrThrow({
      where: { id: variantId },
      select: { stock: true },
    });
    const orders = await testDb.order.count({
      where: { items: { some: { variantId } } },
    });
    const openReservations = await testDb.stockReservation.count({
      where: { variantId, releasedAt: null },
    });

    console.log(
      `[proof] 20 concurrent checkouts on stock 5 → ${created.length}×201, ${outOfStock.length}×409, stock=${variant.stock}, openReservations=${openReservations}`,
    );

    expect(created).toHaveLength(5);
    expect(outOfStock).toHaveLength(15);
    expect(variant.stock).toBe(0);
    expect(orders).toBe(5);
    expect(openReservations).toBe(5);
  });
});
