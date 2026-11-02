export type ImportedProduct = {
  externalId?: string;
  barcode?: string;
  name: string;
  cost: number;
  price: number;
  onHand: number;
  countedQty?: number | null;
  unit: string;
  location?: string;
};

const normalizeHeader = (value: unknown) => String(value ?? "")
  .trim().toLowerCase()
  .replace(/[\u064B-\u065F\u0670]/g, "")
  .replace(/[أإآ]/g, "ا")
  .replace(/ة/g, "ه")
  .replace(/[\s_\-./\\()\[\]]/g, "");

const aliases: Record<keyof ImportedProduct, string[]> = {
  externalId: ["معرفخارجي", "المعرفالخارجي", "externalid", "externalidentifier", "id", "معرف", "الكودالخارجي"],
  barcode: ["باركود", "الباركود", "barcode", "ean", "upc", "رمزالصنف"],
  name: ["الاسم", "اسمالمنتج", "اسمالصنف", "productname", "name", "product", "الصنف", "المنتج"],
  cost: ["cost", "التكلفه", "تكلفه", "سعرالتكلفه", "سعرالشراء", "purchaseprice"],
  price: ["price", "السعر", "سعرالبيع", "سعر", "retailprice", "sellingprice"],
  onHand: ["الكميهفياليد", "الكميهفيالمخزن", "الكميهالمتاحه", "qty", "quantity", "quantityonhand", "quantityinstock", "stockquantity", "onhand", "stock", "المخزون", "رصيدالمخزون", "رصيدالكميه"],
  countedQty: ["الكميهالمحسوبه", "الكميهالمعدوده", "countedquantity", "countedqty", "الجرد", "الكميهالمجرده"],
  unit: ["وحدهالقياس", "الوحده", "unit", "uom", "وحده"],
  location: ["الموقع", "مكانالتخزين", "location", "shelf", "المخزن", "الرف"],
};

function parseNumber(value: unknown, fallback = 0): number {
  if (value == null || String(value).trim() === "") return fallback;
  const normalized = String(value)
    .replace(/[٠-٩]/g, (digit) => String("٠١٢٣٤٥٦٧٨٩".indexOf(digit)))
    .replace(/٬/g, "")
    .replace(/٫/g, ".")
    .replace(/,/g, "")
    .trim();
  const n = Number(normalized);
  return Number.isFinite(n) ? n : Number.NaN;
}

export function parseProductRows(rows: unknown[][]) {
  const issues: string[] = [];
  if (!rows.length) return { items: [] as ImportedProduct[], issues: ["الملف فارغ"] };
  const headerIndex = rows.slice(0, 5).findIndex((row) => {
    const joined = row.map(normalizeHeader).join("|");
    return aliases.name.some((a) => joined.includes(a)) && aliases.barcode.some((a) => joined.includes(a));
  });
  if (headerIndex < 0) return { items: [] as ImportedProduct[], issues: ["لم أتعرف على صف العناوين؛ تأكد من وجود عمودي الاسم والباركود"] };
  const header = rows[headerIndex].map(normalizeHeader);
  const columns: Partial<Record<keyof ImportedProduct, number>> = {};
  (Object.keys(aliases) as (keyof ImportedProduct)[]).forEach((field) => {
    const index = header.findIndex((h) => aliases[field].includes(h));
    if (index >= 0) columns[field] = index;
  });
  if (columns.name === undefined || columns.barcode === undefined) return { items: [] as ImportedProduct[], issues: ["تعذر تحديد الاسم أو الباركود من العناوين"] };
  const read = (row: unknown[], field: keyof ImportedProduct) => {
    const index = columns[field];
    return index === undefined ? "" : String(row[index] ?? "").trim();
  };
  const items: ImportedProduct[] = [];
  const seenExternalIds = new Set<string>();
  const seenBarcodes = new Set<string>();
  rows.slice(headerIndex + 1).forEach((row, offset) => {
    const name = read(row, "name");
    const barcode = read(row, "barcode");
    const externalId = read(row, "externalId");
    if (!name && !barcode && !externalId) return;
    const rowNo = headerIndex + offset + 2;
    if (!name) { issues.push(`صف ${rowNo}: اسم المنتج فارغ`); return; }
    if (!externalId && !barcode) { issues.push(`صف ${rowNo}: أدخل المعرف الخارجي أو الباركود`); return; }
    const cost = parseNumber(read(row, "cost"));
    const price = parseNumber(read(row, "price"));
    const onHand = parseNumber(read(row, "onHand"));
    const countedValue = read(row, "countedQty");
    const countedQty = countedValue ? parseNumber(countedValue) : null;
    if ([cost, price, onHand, countedQty].some((v) => typeof v === "number" && !Number.isFinite(v))) {
      issues.push(`صف ${rowNo}: قيمة رقمية غير صالحة`); return;
    }
    if (cost < 0 || price < 0 || onHand < 0 || (countedQty != null && countedQty < 0)) {
      issues.push(`صف ${rowNo}: لا تقبل الكميات والأسعار السالبة`); return;
    }
    if ((externalId && seenExternalIds.has(externalId)) || (barcode && seenBarcodes.has(barcode))) {
      issues.push(`صف ${rowNo}: تكرار للمعرف الخارجي أو الباركود`); return;
    }
    if (externalId) seenExternalIds.add(externalId);
    if (barcode) seenBarcodes.add(barcode);
    items.push({ externalId: externalId || undefined, barcode: barcode || undefined, name, cost, price, onHand, countedQty, unit: read(row, "unit") || "قطعة", location: read(row, "location") || undefined });
  });
  return { items, issues };
}
