import { beforeEach, describe, expect, it } from "vitest";

import { parseCheckoutBody, placeOrder } from "@/lib/checkout";

import {
  createCartWithLine,
  createAddress,
  createUser,
  createVariant,
  resetDatabase,
  testDb,
} from "./helpers";

beforeEach(async () => {
  await resetDatabase();
});

describe("client-supplied prices", () => {
  it("ignores totalCents in the body and prices from Variant.priceCents", async () => {
    const { variantId } = await createVariant({ priceCents: 2_000, stock: 5 });
    const userId = await createUser();
    const addressId = await createAddress(userId);
    const { version } = await createCartWithLine({
      userId,
      variantId,
      quantity: 1,
    });

    const parsed = parseCheckoutBody({
      addressId,
      cartVersion: version,
      totalCents: 1,
      shippingCents: 0,
      subtotalCents: 1,
    });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) {
      throw new Error("body should parse");
    }
    expect(parsed).not.toHaveProperty("totalCents");

    const result = await placeOrder({ userId, ...parsed });
    expect(result.kind).toBe("created");
    if (result.kind !== "created") {
      throw new Error("expected a created order");
    }

    expect(result.order.subtotalCents).toBe(2_000);
    expect(result.order.shippingCents).toBe(490);
    expect(result.order.totalCents).toBe(2_490);
    expect(result.order.totalCents).toBe(
      result.order.subtotalCents + result.order.shippingCents,
    );

    const stored = await testDb.order.findUniqueOrThrow({
      where: { id: result.order.id },
      select: { totalCents: true, subtotalCents: true, shippingCents: true },
    });
    expect(stored.totalCents).toBe(2_490);
  });

  it("re-prices after a price change instead of trusting the preview", async () => {
    const { variantId } = await createVariant({ priceCents: 2_000, stock: 5 });
    const userId = await createUser();
    const addressId = await createAddress(userId);
    const { version } = await createCartWithLine({
      userId,
      variantId,
      quantity: 2,
    });

    await testDb.variant.update({
      where: { id: variantId },
      data: { priceCents: 3_000 },
    });

    const result = await placeOrder({ userId, addressId, cartVersion: version });
    expect(result.kind).toBe("created");
    if (result.kind !== "created") {
      throw new Error("expected a created order");
    }

    expect(result.order.subtotalCents).toBe(6_000);
    expect(result.order.shippingCents).toBe(490);
    expect(result.order.totalCents).toBe(6_490);
    expect(result.order.items[0]?.unitPriceCents).toBe(3_000);
  });
});
