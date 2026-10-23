import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/auth", async () => {
  const { sessionStorage } = await import("./helpers/session");
  return {
    auth: async () => {
      const store = sessionStorage.getStore();
      return store === undefined ? null : { user: { id: store.userId } };
    },
  };
});

import { POST } from "@/app/api/checkout/route";
import { db } from "@/lib/db";
import { resetRateLimit } from "@/lib/rate-limit";

import {
  cleanupFixture,
  createCart,
  createCatalog,
  createUsers,
  runMigrations,
  type CatalogFixture,
} from "./helpers/fixtures";
import { checkoutRequest, readCheckout } from "./helpers/http";
import { withUser } from "./helpers/session";

// The headline concurrency proof: 20 independent shoppers race for 5 units.
//
// Each shopper has their own account, cart, cart version and client address,
// so neither rate-limit window can mask a stock failure. The only shared state
// is the variant row. Exactly five orders may exist; the rest are 409s; stock
// must be 0 and exactly five reservations must be open.

const SHOPPERS = 20;
const STOCK = 5;

let catalog: CatalogFixture;
const userIds: string[] = [];
const cartVersions: string[] = [];

beforeAll(async () => {
  runMigrations();
  catalog = await createCatalog({
    stock: STOCK,
    priceCents: 1_000,
    label: "oversell",
  });
  const users = await createUsers("oversell", SHOPPERS);
  userIds.push(...users);

  for (const userId of users) {
    const cart = await createCart(userId, [
      { variantId: catalog.variantId, quantity: 1 },
    ]);
    cartVersions.push(cart.cartVersion);
  }
}, 120_000);

beforeEach(() => {
  resetRateLimit();
});

afterAll(async () => {
  await cleanupFixture({ userIds, catalogs: [catalog] });
  await db.$disconnect();
});

describe("20 concurrent checkouts against stock 5", () => {
  it("accepts exactly five orders, leaves stock at zero and five open reservations", async () => {
    const attempts = userIds.map((userId, index) => {
      const cartVersion = cartVersions[index];
      if (cartVersion === undefined) {
        throw new Error("missing cart version");
      }
      return {
        userId,
        cartVersion,
        addressId: randomUUID(),
        ip: `198.51.100.${index + 1}`,
      };
    });

    const responses = await Promise.all(
      attempts.map((attempt) =>
        withUser(attempt.userId, () =>
          POST(
            checkoutRequest(
              {
                addressId: attempt.addressId,
                cartVersion: attempt.cartVersion,
              },
              attempt.ip,
            ),
          ),
        ),
      ),
    );

    const parsed = await Promise.all(responses.map(readCheckout));
    const accepted = parsed.filter((response) => response.status === 201);
    const rejected = parsed.filter((response) => response.status === 409);

    expect(accepted).toHaveLength(STOCK);
    expect(rejected).toHaveLength(SHOPPERS - STOCK);
    for (const response of rejected) {
      expect(response.body.error).toBe("OUT_OF_STOCK");
    }
    // Nothing else leaked out of the race: no 500s, no rate limiting.
    expect(
      parsed.every((response) => response.status === 201 || response.status === 409),
    ).toBe(true);

    const orders = await db.order.findMany({
      where: { userId: { in: userIds } },
      select: { id: true, status: true, totalCents: true },
    });
    expect(orders).toHaveLength(STOCK);
    expect(orders.every((order) => order.status === "PENDING")).toBe(true);
    expect(orders.every((order) => order.totalCents === 1_000)).toBe(true);

    const variant = await db.variant.findUnique({
      where: { id: catalog.variantId },
      select: { stock: true },
    });
    expect(variant?.stock).toBe(0);

    const reservations = await db.stockReservation.findMany({
      where: {
        orderId: { in: orders.map((order) => order.id) },
        releasedAt: null,
      },
      select: { qty: true, expiresAt: true },
    });
    expect(reservations).toHaveLength(STOCK);
    expect(reservations.every((reservation) => reservation.qty === 1)).toBe(true);

    const now = Date.now();
    for (const reservation of reservations) {
      // 30 minutes from the checkout, not from process start.
      expect(reservation.expiresAt.getTime()).toBeGreaterThan(
        now + 29 * 60 * 1_000,
      );
      expect(reservation.expiresAt.getTime()).toBeLessThanOrEqual(
        now + 31 * 60 * 1_000,
      );
    }

    // Every accepted request names an order that exists; every rejected one
    // names none, so the 15 losers left no order rows behind.
    const acceptedIds = accepted.map((response) => response.body.orderId);
    expect(new Set(acceptedIds).size).toBe(STOCK);
    for (const orderId of acceptedIds) {
      expect(orders.some((order) => order.id === orderId)).toBe(true);
    }
    for (const response of rejected) {
      expect(response.body.orderId).toBeUndefined();
    }

    // Captured verbatim into docs/proof/concurrency-run.txt; the terminal panel
    // in the hero image renders that file, not a retyped claim.
    console.info(
      `[proof] ${SHOPPERS} concurrent checkouts on stock ${STOCK} → ` +
        `${accepted.length}×201, ${rejected.length}×409, ` +
        `stock=${String(variant?.stock)}, openReservations=${reservations.length}`,
    );
  });
});
