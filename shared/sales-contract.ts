import { z } from "zod";

export const checkoutSaleInput = z.object({
  lines: z.array(z.object({
    productId: z.number().int().positive(),
    quantity: z.number().finite().positive(),
  })).min(1).max(500).refine(
    (lines) => new Set(lines.map((line) => line.productId)).size === lines.length,
    "لا تكرر المنتج في سطور الفاتورة",
  ),
  paymentMethod: z.enum(["cash", "card", "wallet"]),
  paid: z.number().finite().min(0),
  discount: z.number().finite().min(0).default(0),
  shiftId: z.number().int().positive(),
});
