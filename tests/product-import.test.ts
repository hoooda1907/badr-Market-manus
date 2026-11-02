import { describe, expect, it } from "vitest";
import { parseProductRows } from "../shared/product-import";

describe("product import header matching", () => {
  it("parses the supplied Arabic/English product sheet", () => {
    const result = parseProductRows([
      ["معرف خارجي", "باركود", "الاسم", "cost", "price", "الكمية في اليد", "الكمية المحسوبة", "وحدة القياس", "الموقع"],
      ["__export__.product_template_93112_e81dd2e8", "6223007521109", "المراعى تريتس زبادي حلو وكريمى من 105 جرام", "10.30", "11.00", "0.00", "", "قطعة", ""],
    ]);
    expect(result.issues).toEqual([]);
    expect(result.items[0]).toMatchObject({ externalId: "__export__.product_template_93112_e81dd2e8", barcode: "6223007521109", cost: 10.3, price: 11, onHand: 0, countedQty: null, unit: "قطعة" });
  });

  it("accepts slightly different headers and Arabic numerals", () => {
    const result = parseProductRows([
      ["معرف", "EAN", "اسم المنتج", "تكلفة", "سعر البيع", "المخزون", "الجرد", "الوحدة", "مكان التخزين"],
      ["p-1", "6221", "حليب", "١٠٫٥٠", "١٢٫٠٠", "٢", "١", "عبوة", "رف أ"],
    ]);
    expect(result.items[0]).toMatchObject({ barcode: "6221", name: "حليب", cost: 10.5, price: 12, onHand: 2, countedQty: 1, unit: "عبوة", location: "رف أ" });
  });

  it("does not confuse counted quantity with on-hand when columns are reordered", () => {
    const result = parseProductRows([
      ["Barcode", "Product", "Counted Quantity", "Quantity On Hand", "Cost", "Price"],
      ["123", "مياه", "7", "9", "2", "3"],
    ]);
    expect(result.items[0]).toMatchObject({ barcode: "123", name: "مياه", countedQty: 7, onHand: 9, cost: 2, price: 3 });
  });

  it("rejects rows without a stable identifier and duplicate barcodes across different external IDs", () => {
    const result = parseProductRows([
      ["External ID", "Barcode", "Name", "Cost", "Price", "Quantity"],
      ["one", "6223", "زبادي", "10", "11", "1"],
      ["two", "6223", "زبادي آخر", "10", "11", "1"],
      ["", "", "صنف بلا معرف", "2", "3", "1"],
    ]);

    expect(result.items).toHaveLength(1);
    expect(result.issues).toHaveLength(2);
    expect(result.issues.join(" ")).toContain("تكرار للمعرف الخارجي أو الباركود");
    expect(result.issues.join(" ")).toContain("أدخل المعرف الخارجي أو الباركود");
  });
});
