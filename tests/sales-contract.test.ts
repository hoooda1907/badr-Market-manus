import { describe, expect, it } from "vitest";
import { checkoutSaleInput } from "../shared/sales-contract";

const saleWithoutShift = {
  lines: [{ productId: 1, quantity: 1 }],
  paymentMethod: "cash",
  paid: 10,
};

describe("sales checkout contract", () => {
  it("rejects a sale unless it is linked to a positive shift ID", () => {
    expect(checkoutSaleInput.safeParse(saleWithoutShift).success).toBe(false);
    expect(checkoutSaleInput.safeParse({ ...saleWithoutShift, shiftId: 0 }).success).toBe(false);
  });

  it("accepts a well-formed sale linked to a shift", () => {
    expect(checkoutSaleInput.safeParse({ ...saleWithoutShift, shiftId: 7 }).success).toBe(true);
  });

  it("rejects the removed mixed and credit payment methods", () => {
    expect(checkoutSaleInput.safeParse({ ...saleWithoutShift, paymentMethod: "mixed", shiftId: 7 }).success).toBe(false);
    expect(checkoutSaleInput.safeParse({ ...saleWithoutShift, paymentMethod: "credit", shiftId: 7 }).success).toBe(false);
  });
});
