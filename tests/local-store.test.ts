import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ImportedProduct } from "../shared/product-import";
import {
  addLocalExpense,
  checkoutLocalSale,
  clockLocalAttendance,
  closeLocalShift,
  createInitialManager,
  createLocalEmployee,
  createLocalProduct,
  createLocalReceipt,
  getLocalAttendance,
  getLocalBestSellers,
  getLocalEmployeeReport,
  getLocalExpenses,
  getLocalInventoryReport,
  getLocalShiftReport,
  getLocalSummary,
  initializeLocalStore,
  loginLocalEmployee,
  openLocalShift,
  setCountedQuantity,
  setLocalDatabaseForTesting,
} from "../lib/local-store/service";
import { MemoryLocalDatabase } from "./helpers/memory-local-database";

let saltCounter = 0;
vi.mock("expo-crypto", () => ({
  getRandomBytesAsync: async (length: number) => {
    saltCounter += 1;
    return Uint8Array.from({ length }, (_, index) => (saltCounter * 17 + index) & 0xff);
  },
}));

const product: ImportedProduct = {
  externalId: "test-product-001",
  barcode: "6223007521109",
  name: "اختبار منتج أسواق بدر",
  cost: 10.3,
  price: 11,
  onHand: 2,
  countedQty: null,
  unit: "قطعة",
  location: "رف 1",
};

describe("local store services", () => {
  let database: MemoryLocalDatabase;
  let manager: Awaited<ReturnType<typeof createInitialManager>>;

  beforeEach(async () => {
    saltCounter = 0;
    database = new MemoryLocalDatabase();
    setLocalDatabaseForTesting(database);
    await initializeLocalStore();
    manager = await createInitialManager({ code: "MGR01", name: "مدير الاختبار", password: "test-manager-password" });
  });

  it("creates a manager without a default password and validates local credentials", async () => {
    const stored = await database.snapshot("employees");
    expect(stored[0].passwordCredential?.hash).not.toContain("test-manager-password");
    await expect(loginLocalEmployee("MGR01", "wrong-password")).rejects.toThrow("Invalid credentials");
    await expect(loginLocalEmployee("MGR01", "test-manager-password")).resolves.toMatchObject({ role: "manager", code: "MGR01" });
    await expect(createInitialManager({ code: "MGR02", name: "مدير ثانٍ", password: "another-manager-password" })).rejects.toThrow("Manager already exists");
  });

  it("enforces employee roles in local business operations", async () => {
    await createLocalEmployee(manager, { code: "CSH01", name: "كاشير", role: "cashier", pin: "1234" });
    const cashier = await loginLocalEmployee("CSH01", "1234");
    await expect(loginLocalEmployee("CSH01", "12ab")).rejects.toThrow("Invalid credentials");
    await expect(createLocalProduct(cashier, product)).rejects.toThrow("Permission required: inventory:manage");
    await expect(createLocalEmployee(cashier, { code: "CSH02", name: "آخر", role: "cashier", pin: "5678" })).rejects.toThrow("Manager permission required");
  });

  it("keeps sales, stock movement and shift cash consistent in one local transaction", async () => {
    const productId = await createLocalProduct(manager, product);
    await createLocalEmployee(manager, { code: "CSH01", name: "كاشير", role: "cashier", pin: "1234" });
    const cashier = await loginLocalEmployee("CSH01", "1234");
    const shift = await openLocalShift(cashier, 100);

    await expect(checkoutLocalSale(cashier, { lines: [{ productId, quantity: 3 }], paymentMethod: "cash", paid: 33, shiftId: shift.id })).rejects.toThrow("Insufficient stock");
    expect(await database.snapshot("sales")).toHaveLength(0);
    expect((await database.snapshot("products"))[0].onHand).toBe("2.000");

    await expect(checkoutLocalSale(cashier, { lines: [{ productId, quantity: 1 }], paymentMethod: "cash", paid: 5, shiftId: shift.id })).rejects.toThrow("Payment is insufficient");
    const sale = await checkoutLocalSale(cashier, { lines: [{ productId, quantity: 2 }], paymentMethod: "cash", paid: 21, discount: 1, shiftId: shift.id });
    expect(sale.total).toBe("21.00");
    expect((await database.snapshot("products"))[0].onHand).toBe("0.000");
    expect((await database.snapshot("stockMovements")).at(-1)?.quantityDelta).toBe("-2.000");
    expect(await getLocalBestSellers(manager)).toMatchObject([{ productId, quantity: "2.000", total: "22.00" }]);
    expect(await getLocalSummary(manager)).toMatchObject({ count: "1", total: "21.00", cash: "21.00", grossProfit: "0.40" });
    await expect(closeLocalShift(cashier, shift.id, 121)).resolves.toMatchObject({ expected: "121.00", difference: "0.00" });
    expect((await database.snapshot("shifts"))[0].status).toBe("closed");
  });

  it("records receipts, inventory counts, attendance and cash/non-cash expenses locally", async () => {
    const productId = await createLocalProduct(manager, product);
    const receipt = await createLocalReceipt(manager, {
      supplier: "مورد الاختبار",
      invoiceNo: "INV-LOCAL-1",
      lines: [{ productId, quantity: 5, cost: 9.5 }],
    });
    expect(receipt.reference).toMatch(/^R-/);
    expect((await database.snapshot("products"))[0]).toMatchObject({ onHand: "7.000", cost: "9.50" });
    expect((await database.snapshot("receipts"))[0]).toMatchObject({ invoiceNo: "INV-LOCAL-1", totalCost: "47.50" });

    await setCountedQuantity(manager, productId, 6);
    expect((await database.snapshot("products"))[0]).toMatchObject({ onHand: "6.000", countedQty: "6.000" });
    expect(await getLocalInventoryReport(manager)).toMatchObject({ productCount: 1, outOfStockCount: 0, inventoryCost: "57.00" });
    await expect(clockLocalAttendance(manager)).resolves.toMatchObject({ event: "in" });
    await expect(clockLocalAttendance(manager)).resolves.toMatchObject({ event: "out" });
    expect(await getLocalAttendance(manager)).toHaveLength(2);
    expect(await getLocalEmployeeReport(manager)).toMatchObject([{ code: "MGR01", attendanceCount: 2, salesCount: 0, openShift: false }]);

    const shift = await openLocalShift(manager, 100);
    expect(await getLocalEmployeeReport(manager)).toMatchObject([{ code: "MGR01", openShift: true }]);
    await addLocalExpense(manager, { category: "تشغيل", description: "مصاريف نقدية", amount: 10, paymentMethod: "cash", shiftId: shift.id });
    await addLocalExpense(manager, { category: "صيانة", description: "دفع بطاقة", amount: 5, paymentMethod: "card", shiftId: shift.id });
    expect(await getLocalExpenses(manager)).toHaveLength(2);
    expect(await getLocalSummary(manager)).toMatchObject({ purchases: "47.50", expenses: "15.00", net: "-15.00" });
    await expect(closeLocalShift(manager, shift.id, 90)).resolves.toMatchObject({ expected: "90.00", difference: "0.00" });
    expect(await getLocalShiftReport(manager)).toMatchObject([{ id: shift.id, employeeName: "مدير الاختبار", salesCount: 0, cashExpenses: "10.00", totalExpenses: "15.00", expectedCash: "90.00", actualCash: "90.00" }]);
  });
});
