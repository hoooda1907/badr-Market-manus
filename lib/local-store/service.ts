import { localDatabase } from "./adapter";
import { deriveLocalSecret, verifyLocalSecret } from "../../shared/local-security";
import type { ImportedProduct } from "../../shared/product-import";
import type {
  AttendanceEvent, EmployeeRole, LocalEmployee, LocalEmployeeSession, LocalProduct, LocalShift,
  LocalDatabase, LocalTransaction, PaymentMethod, SecretCredential,
} from "./types";

let database: LocalDatabase = localDatabase;
/** Replace the adapter only in isolated tests; application code uses its platform adapter. */
export function setLocalDatabaseForTesting(adapter: LocalDatabase): void { database = adapter; }

const permissions: Record<EmployeeRole, string[]> = {
  manager: ["*"],
  cashier: ["products:view", "sales:create", "shifts:manage", "attendance:clock"],
  stock: ["products:view", "inventory:view", "inventory:manage", "receipts:create", "attendance:clock"],
};
type Actor = LocalEmployeeSession;
type NewEmployee = { code: string; name: string; role: EmployeeRole; pin?: string; password?: string; phone?: string };
type SaleLineInput = { productId: number; quantity: number };
const money = (n: number) => (Math.round((n + Number.EPSILON) * 100) / 100).toFixed(2);
const qty = (n: number) => (Math.round((n + Number.EPSILON) * 1000) / 1000).toFixed(3);
const num = (v: string | null | undefined) => Number(v ?? 0);
const finite = (n: number, label: string, min = 0) => {
  if (!Number.isFinite(n) || n < min) throw new Error(`Invalid ${label}`);
};
const idref = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
const normalizeCode = (s: string) => s.trim();
const localDayStart = (timestamp = Date.now()) => {
  const date = new Date(timestamp);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
};

async function authorize(tx: LocalTransaction, actor: Actor | number, permission?: string, managerOnly = false): Promise<LocalEmployee> {
  const id = typeof actor === "number" ? actor : actor?.id;
  if (!Number.isSafeInteger(id) || id <= 0) throw new Error("Invalid local session");
  const employee = await tx.get("employees", id);
  if (!employee || !employee.active) throw new Error("Local session is invalid or employee is inactive");
  if (typeof actor !== "number" && (actor.role !== employee.role || actor.code !== employee.code || actor.name !== employee.name)) throw new Error("Local session is stale");
  if (managerOnly && employee.role !== "manager") throw new Error("Manager permission required");
  if (permission && employee.role !== "manager" && !permissions[employee.role].includes("*") && !permissions[employee.role].includes(permission)) throw new Error(`Permission required: ${permission}`);
  return employee;
}
function productInput(p: ImportedProduct) {
  if (!p || typeof p.name !== "string" || !p.name.trim() || typeof p.unit !== "string" || !p.unit.trim()) throw new Error("Invalid product name or unit");
  for (const [v, label] of [[p.cost, "cost"], [p.price, "price"], [p.onHand, "quantity"]] as const) finite(v, label);
  if (p.countedQty != null) finite(p.countedQty, "counted quantity");
  return { externalId: p.externalId?.trim() || null, barcode: p.barcode?.trim() || null, name: p.name.trim(), cost: money(p.cost), price: money(p.price), onHand: qty(p.onHand), countedQty: p.countedQty == null ? null : qty(p.countedQty), unit: p.unit.trim(), location: p.location?.trim() || null };
}
async function upsertImported(tx: LocalTransaction, actorId: number, p: ImportedProduct): Promise<number> {
  const data = productInput(p), all = await tx.all("products");
  const byExt = data.externalId ? all.filter(x => x.externalId === data.externalId) : [];
  const byBar = data.barcode ? all.filter(x => x.barcode === data.barcode) : [];
  if (byExt.length > 1 || byBar.length > 1 || (byExt[0] && byBar[0] && byExt[0].id !== byBar[0].id)) throw new Error("Product identifiers refer to conflicting products");
  const found = byExt[0] ?? byBar[0];
  if (all.some(x => x.id !== found?.id && ((data.externalId && x.externalId === data.externalId) || (data.barcode && x.barcode === data.barcode)))) throw new Error("Duplicate product identifier");
  const now = Date.now();
  if (found) {
    const oldQty = num(found.onHand), nextQty = p.onHand;
    await tx.update("products", found.id, { ...data, active: true, updatedAt: now });
    if (Math.abs(nextQty - oldQty) > 0.0000001) await tx.insert("stockMovements", { productId: found.id, employeeId: actorId, kind: "manual", quantityDelta: qty(nextQty - oldQty), reference: "import", note: "Product import quantity update", createdAt: now });
    return found.id;
  }
  const id = await tx.insert("products", { ...data, active: true, createdAt: now, updatedAt: now });
  if (p.onHand !== 0) await tx.insert("stockMovements", { productId: id, employeeId: actorId, kind: "opening", quantityDelta: qty(p.onHand), reference: "import", note: "Imported opening stock", createdAt: now });
  return id;
}

export async function initializeLocalStore(): Promise<void> { await database.initialize(); }
export async function hasManagerAccount(): Promise<boolean> {
  return database.transaction(async tx => (await tx.all("employees")).some(e => e.role === "manager"));
}
export async function createInitialManager(input: { code: string; name: string; password: string }): Promise<LocalEmployeeSession> {
  if (!input.code.trim() || !input.name.trim() || input.password.length < 8) throw new Error("Manager code/name required and password must be at least 8 characters");
  const passwordCredential: SecretCredential = await deriveLocalSecret(input.password);
  return database.transaction(async tx => {
    if ((await tx.all("employees")).some(e => e.role === "manager")) throw new Error("Manager already exists");
    if ((await tx.all("employees")).some(e => e.code === normalizeCode(input.code))) throw new Error("Employee code already exists");
    const id = await tx.insert("employees", { code: normalizeCode(input.code), name: input.name.trim(), role: "manager", phone: null, pinCredential: null, passwordCredential, active: true, createdAt: Date.now() });
    return { id, code: normalizeCode(input.code), name: input.name.trim(), role: "manager" };
  });
}
export async function loginLocalEmployee(code: string, secret: string): Promise<LocalEmployeeSession> {
  return database.transaction(async tx => {
    const employees = await tx.all("employees"), managerExists = employees.some(e => e.role === "manager");
    if (!managerExists) throw new Error("Initial manager account has not been created");
    const employee = employees.find(e => e.code === normalizeCode(code) && e.active);
    if (!employee) throw new Error("Invalid credentials");
    const credential = employee.role === "manager" ? employee.passwordCredential : employee.pinCredential;
    if (!credential || (employee.role !== "manager" && !/^\d{4,12}$/.test(secret)) || !(await verifyLocalSecret(secret, credential))) throw new Error("Invalid credentials");
    return { id: employee.id, code: employee.code, name: employee.name, role: employee.role };
  });
}
export async function getLocalEmployeeSession(id: number): Promise<LocalEmployeeSession | null> {
  return database.transaction(async tx => {
    const e = await tx.get("employees", id);
    if (!e || !e.active || !(await tx.all("employees")).some(x => x.role === "manager")) return null;
    return { id: e.id, code: e.code, name: e.name, role: e.role };
  });
}
export async function listLocalEmployees(actor: Actor) {
  return database.transaction(async tx => { await authorize(tx, actor, undefined, true); return (await tx.all("employees")).map(({ id, code, name, role, phone, active, createdAt }) => ({ id, code, name, role, phone, active: Boolean(active), createdAt })); });
}
export async function createLocalEmployee(actor: Actor, input: NewEmployee): Promise<number> {
  if (!input.code.trim() || !input.name.trim()) throw new Error("Code and name are required");
  if (input.role === "manager") { if (!input.password || input.password.length < 8) throw new Error("Manager password must be at least 8 characters"); }
  else if (!input.pin || !/^\d{4,12}$/.test(input.pin)) throw new Error("PIN must contain 4 to 12 digits");
  const pinCredential = input.role === "manager" ? null : await deriveLocalSecret(input.pin!);
  const passwordCredential = input.role === "manager" ? await deriveLocalSecret(input.password!) : null;
  return database.transaction(async tx => {
    await authorize(tx, actor, undefined, true);
    const code = normalizeCode(input.code);
    if ((await tx.all("employees")).some(e => e.code === code)) throw new Error("Employee code already exists");
    return tx.insert("employees", { code, name: input.name.trim(), role: input.role, phone: input.phone?.trim() || null, pinCredential, passwordCredential, active: true, createdAt: Date.now() });
  });
}
export async function setLocalEmployeeActive(actor: Actor, id: number, active: boolean): Promise<void> {
  await database.transaction(async tx => { await authorize(tx, actor, undefined, true); const e = await tx.get("employees", id); if (!e) throw new Error("Employee not found"); if (e.id === (typeof actor === "number" ? actor : actor.id) && !active) throw new Error("Cannot deactivate current manager"); await tx.update("employees", id, { active: Boolean(active) }); });
}
export async function changeLocalManagerPassword(actor: Actor, currentPassword: string, newPassword: string): Promise<void> {
  if (newPassword.length < 8) throw new Error("Password must be at least 8 characters");
  await database.transaction(async tx => { const e = await authorize(tx, actor, undefined, true); if (!e.passwordCredential || !(await verifyLocalSecret(currentPassword, e.passwordCredential))) throw new Error("Current password is incorrect"); await tx.update("employees", e.id, { passwordCredential: await deriveLocalSecret(newPassword) }); });
}
export async function listLocalProducts(actor: Actor, q = "", limit = 100): Promise<LocalProduct[]> {
  return database.transaction(async tx => { await authorize(tx, actor, "products:view"); const search = q.trim().toLowerCase(); const n = Number.isFinite(limit) ? Math.max(0, Math.min(1000, Math.floor(limit))) : 100; return (await tx.all("products")).filter(p => p.active && (!search || [p.name, p.barcode, p.externalId].some(v => v?.toLowerCase().includes(search)))).sort((a,b) => a.name.localeCompare(b.name)).slice(0,n); });
}
export async function createLocalProduct(actor: Actor, item: ImportedProduct): Promise<number> {
  return database.transaction(async tx => { const e = await authorize(tx, actor, "inventory:manage"); const d = productInput(item); const all = await tx.all("products"); if (all.some(p => (d.externalId && p.externalId === d.externalId) || (d.barcode && p.barcode === d.barcode))) throw new Error("Duplicate product identifier"); const now = Date.now(); const id = await tx.insert("products", { ...d, active: true, createdAt: now, updatedAt: now }); if (item.onHand) await tx.insert("stockMovements", { productId: id, employeeId: e.id, kind: "opening", quantityDelta: qty(item.onHand), reference: null, note: "Initial stock", createdAt: now }); return id; });
}
export async function importLocalProducts(actor: Actor, items: ImportedProduct[]): Promise<{ imported: number }> {
  return database.transaction(async tx => { const e = await authorize(tx, actor, "inventory:manage"); const staged = await tx.all("products"); const seenExt = new Set<string>(), seenBar = new Set<string>(); for (const item of items) { const d = productInput(item); if (d.externalId && seenExt.has(d.externalId) || d.barcode && seenBar.has(d.barcode)) throw new Error("Duplicate identifier within import"); if (d.externalId) seenExt.add(d.externalId); if (d.barcode) seenBar.add(d.barcode); const a = d.externalId ? staged.find(x => x.externalId === d.externalId) : undefined, b = d.barcode ? staged.find(x => x.barcode === d.barcode) : undefined; if (a && b && a.id !== b.id) throw new Error("Import identifiers refer to conflicting products"); } for (const item of items) await upsertImported(tx, e.id, item); return { imported: items.length }; });
}
export async function setCountedQuantity(actor: Actor, id: number, countedQty: number): Promise<void> {
  finite(countedQty, "counted quantity"); await database.transaction(async tx => { const e = await authorize(tx, actor, "inventory:manage"), p = await tx.get("products", id); if (!p || !p.active) throw new Error("Product not found"); const delta = countedQty - num(p.onHand), now = Date.now(); await tx.update("products", id, { countedQty: qty(countedQty), onHand: qty(countedQty), updatedAt: now }); await tx.insert("stockMovements", { productId: id, employeeId: e.id, kind: "count", quantityDelta: qty(delta), reference: null, note: "Physical stock count", createdAt: now }); });
}
export async function adjustLocalInventory(actor: Actor, productId: number, delta: number, note?: string): Promise<void> {
  finite(Math.abs(delta), "quantity adjustment"); await database.transaction(async tx => { const e = await authorize(tx, actor, "inventory:manage"), p = await tx.get("products", productId); if (!p || !p.active) throw new Error("Product not found"); const next = num(p.onHand) + delta; if (next < 0) throw new Error("Insufficient stock"); await tx.update("products", p.id, { onHand: qty(next), updatedAt: Date.now() }); await tx.insert("stockMovements", { productId: p.id, employeeId: e.id, kind: "manual", quantityDelta: qty(delta), reference: null, note: note?.trim() || null, createdAt: Date.now() }); });
}
async function cashBalance(tx: LocalTransaction, shift: LocalShift): Promise<number> {
  const [sales, expenses] = await Promise.all([tx.all("sales"), tx.all("expenses")]);
  return num(shift.openingCash) + sales.filter(s => s.shiftId === shift.id && s.paymentMethod === "cash").reduce((a,s) => a + num(s.total), 0) - expenses.filter(x => x.shiftId === shift.id && x.paymentMethod === "cash").reduce((a,x) => a + num(x.amount), 0);
}
export async function getCurrentLocalShift(actor: Actor): Promise<LocalShift | null> {
  return database.transaction(async tx => { const e = await authorize(tx, actor, "shifts:manage"); return (await tx.all("shifts")).filter(s => s.employeeId === e.id && s.status === "open").sort((a,b) => b.startedAt-a.startedAt)[0] ?? null; });
}
export async function openLocalShift(actor: Actor, openingCash: number): Promise<{ id: number }> {
  finite(openingCash, "opening cash"); return database.transaction(async tx => { const e = await authorize(tx, actor, "shifts:manage"); if ((await tx.all("shifts")).some(s => s.employeeId === e.id && s.status === "open")) throw new Error("An open shift already exists"); const id = await tx.insert("shifts", { employeeId: e.id, status: "open", openingCash: money(openingCash), expectedCash: null, actualCash: null, difference: null, startedAt: Date.now(), closedAt: null }); return { id }; });
}
export async function closeLocalShift(actor: Actor, id: number, actualCash: number): Promise<{ expected: string; difference: string }> {
  finite(actualCash, "actual cash"); return database.transaction(async tx => { const e = await authorize(tx, actor, "shifts:manage"), s = await tx.get("shifts", id); if (!s || s.employeeId !== e.id || s.status !== "open") throw new Error("Open shift not found for employee"); const expected = await cashBalance(tx, s), difference = actualCash - expected; await tx.update("shifts", id, { status: "closed", expectedCash: money(expected), actualCash: money(actualCash), difference: money(difference), closedAt: Date.now() }); return { expected: money(expected), difference: money(difference) }; });
}
export async function checkoutLocalSale(
  actor: Actor,
  input: { lines: SaleLineInput[]; paymentMethod: PaymentMethod; paid: number; discount?: number; shiftId?: number },
): Promise<{ saleId: number; receiptNo: string; total: string }> {
  if (!input.lines.length) throw new Error("Sale requires at least one line");
  finite(input.paid, "paid amount");
  const discount = input.discount ?? 0;
  finite(discount, "discount");

  return database.transaction(async tx => {
    const employee = await authorize(tx, actor, "sales:create");
    const shift = input.shiftId
      ? await tx.get("shifts", input.shiftId)
      : (await tx.all("shifts")).find(item => item.employeeId === employee.id && item.status === "open");
    if (!shift || shift.employeeId !== employee.id || shift.status !== "open") {
      throw new Error("An open shift belonging to this employee is required");
    }

    const grouped = new Map<number, number>();
    for (const line of input.lines) {
      if (!Number.isSafeInteger(line.productId)) throw new Error("Invalid product");
      finite(line.quantity, "sale quantity");
      if (line.quantity === 0) throw new Error("Quantity must be positive");
      grouped.set(line.productId, (grouped.get(line.productId) ?? 0) + line.quantity);
    }

    const lines: { product: LocalProduct; quantity: number; amount: number }[] = [];
    let subtotal = 0;
    for (const [productId, quantity] of grouped) {
      const product = await tx.get("products", productId);
      if (!product || !product.active || quantity <= 0) throw new Error("Invalid product or quantity");
      if (num(product.onHand) < quantity) throw new Error(`Insufficient stock for ${product.name}`);
      const amount = Math.round(quantity * num(product.price) * 100) / 100;
      subtotal += amount;
      lines.push({ product, quantity, amount });
    }

    subtotal = Math.round(subtotal * 100) / 100;
    const total = Math.round((subtotal - discount) * 100) / 100;
    if (discount > subtotal) throw new Error("Discount exceeds subtotal");
    const paymentMethods: PaymentMethod[] = ["cash", "card", "wallet"];
    if (!paymentMethods.includes(input.paymentMethod)) throw new Error("Invalid payment method");
    if (input.paid < total) throw new Error("Payment is insufficient");
    if (input.paid > total) throw new Error("Paid amount cannot exceed the sale total");

    const createdAt = Date.now();
    const receiptNo = `L-${createdAt.toString(36)}-${idref()}`;
    const saleId = await tx.insert("sales", {
      receiptNo,
      employeeId: employee.id,
      shiftId: shift.id,
      subtotal: money(subtotal),
      discount: money(discount),
      total: money(total),
      paid: money(input.paid),
      paymentMethod: input.paymentMethod,
      createdAt,
    });

    for (const line of lines) {
      await tx.insert("saleLines", {
        saleId,
        productId: line.product.id,
        nameSnapshot: line.product.name,
        quantity: qty(line.quantity),
        price: line.product.price,
        cost: line.product.cost,
        lineTotal: money(line.amount),
      });
      await tx.update("products", line.product.id, {
        onHand: qty(num(line.product.onHand) - line.quantity),
        updatedAt: createdAt,
      });
      await tx.insert("stockMovements", {
        productId: line.product.id,
        employeeId: employee.id,
        kind: "sale",
        quantityDelta: qty(-line.quantity),
        reference: receiptNo,
        note: null,
        createdAt,
      });
    }

    return { saleId, receiptNo, total: money(total) };
  });
}
export async function createLocalReceipt(actor: Actor, input: { supplier: string; invoiceNo?: string; lines: { productId: number; quantity: number; cost: number }[] }): Promise<{ receiptId: number; reference: string }> {
  if (!input.supplier.trim() || !input.lines.length) throw new Error("Supplier and receipt lines are required"); return database.transaction(async tx => { const e = await authorize(tx, actor, "receipts:create"), reference = `R-${idref()}`, now = Date.now(); let total = 0; const prepared: { p: LocalProduct; q: number; cost: number; amount: number }[] = []; for (const line of input.lines) { finite(line.quantity, "receipt quantity"); finite(line.cost, "receipt cost"); if (line.quantity <= 0) throw new Error("Receipt quantity must be positive"); const p = await tx.get("products", line.productId); if (!p || !p.active) throw new Error("Product not found"); const amount = Math.round(line.quantity * line.cost * 100) / 100; total += amount; prepared.push({ p, q: line.quantity, cost: line.cost, amount }); } const receiptId = await tx.insert("receipts", { reference, supplier: input.supplier.trim(), invoiceNo: input.invoiceNo?.trim() || null, employeeId: e.id, totalCost: money(total), createdAt: now }); for (const line of prepared) { await tx.insert("receiptLines", { receiptId, productId: line.p.id, nameSnapshot: line.p.name, quantity: qty(line.q), cost: money(line.cost), lineTotal: money(line.amount) }); await tx.update("products", line.p.id, { onHand: qty(num(line.p.onHand)+line.q), cost: money(line.cost), updatedAt: now }); await tx.insert("stockMovements", { productId: line.p.id, employeeId: e.id, kind: "receipt", quantityDelta: qty(line.q), reference, note: null, createdAt: now }); } return { receiptId, reference }; });
}
export async function clockLocalAttendance(actor: Actor): Promise<{ event: AttendanceEvent; eventAt: number }> {
  return database.transaction(async tx => { const e = await authorize(tx, actor, "attendance:clock"), rows = (await tx.all("attendance")).filter(a => a.employeeId === e.id && a.eventAt >= localDayStart()).sort((a,b) => b.eventAt-a.eventAt); const event: AttendanceEvent = rows[0]?.event === "in" ? "out" : "in", eventAt = Date.now(); await tx.insert("attendance", { employeeId: e.id, event, eventAt, note: null }); return { event, eventAt }; });
}
export async function getLocalAttendance(actor: Actor) {
  return database.transaction(async tx => { const e = await authorize(tx, actor, "attendance:clock"); const emps = new Map((await tx.all("employees")).map(x => [x.id,x.name])); return (await tx.all("attendance")).filter(a => e.role === "manager" || a.employeeId === e.id).sort((a,b) => b.eventAt-a.eventAt).slice(0,100).map(a => ({ ...a, employeeName: emps.get(a.employeeId) ?? "" })); });
}
export async function addLocalExpense(actor: Actor, input: { category: string; description: string; amount: number; paymentMethod: "cash" | "card" | "wallet"; shiftId?: number }): Promise<number> {
  if (!input.category.trim() || !input.description.trim()) throw new Error("Category and description are required"); finite(input.amount, "expense amount"); return database.transaction(async tx => { const e = await authorize(tx, actor, "shifts:manage"); let shiftId: number | null = input.shiftId ?? null; if (shiftId != null) { const s = await tx.get("shifts", shiftId); if (!s || s.employeeId !== e.id || s.status !== "open") throw new Error("Open employee shift not found"); } return tx.insert("expenses", { category: input.category.trim(), description: input.description.trim(), amount: money(input.amount), paymentMethod: input.paymentMethod, shiftId, employeeId: e.id, createdAt: Date.now() }); });
}
export async function getLocalExpenses(actor: Actor) {
  return database.transaction(async tx => { const e = await authorize(tx, actor, "shifts:manage"), people = new Map((await tx.all("employees")).map(x => [x.id,x.name])); return (await tx.all("expenses")).filter(x => x.createdAt >= localDayStart() && (e.role === "manager" || x.employeeId === e.id)).sort((a,b) => b.createdAt-a.createdAt).map(x => ({ ...x, employeeName: people.get(x.employeeId) ?? "" })); });
}
export async function getLocalSummary(actor: Actor, from?: number) {
  return database.transaction(async tx => {
    await authorize(tx, actor, undefined, true);
    const [sales, saleLines, receipts, expenses] = await Promise.all([
      tx.all("sales"),
      tx.all("saleLines"),
      tx.all("receipts"),
      tx.all("expenses"),
    ]);
    const since = from ?? localDayStart();
    const currentSales = sales.filter(sale => sale.createdAt >= since);
    const currentReceipts = receipts.filter(receipt => receipt.createdAt >= since);
    const currentExpenses = expenses.filter(expense => expense.createdAt >= since);
    const saleIds = new Set(currentSales.map(sale => sale.id));
    const currentSaleLines = saleLines.filter(line => saleIds.has(line.saleId));
    const grossBeforeDiscount = currentSaleLines.reduce(
      (sum, line) => sum + num(line.lineTotal) - num(line.cost) * num(line.quantity),
      0,
    );
    const discounts = currentSales.reduce((sum, sale) => sum + num(sale.discount), 0);
    const grossProfit = grossBeforeDiscount - discounts;
    const total = currentSales.reduce((sum, sale) => sum + num(sale.total), 0);
    const cash = currentSales
      .filter(sale => sale.paymentMethod === "cash")
      .reduce((sum, sale) => sum + num(sale.total), 0);
    const expensesTotal = currentExpenses.reduce((sum, expense) => sum + num(expense.amount), 0);
    const purchases = currentReceipts.reduce((sum, receipt) => sum + num(receipt.totalCost), 0);

    return {
      count: String(currentSales.length),
      total: money(total),
      cash: money(cash),
      expenses: money(expensesTotal),
      purchases: money(purchases),
      grossProfit: money(grossProfit),
      net: money(grossProfit - expensesTotal),
    };
  });
}
export async function getLocalBestSellers(actor: Actor, from = localDayStart()): Promise<{ productId: number; name: string; quantity: string; total: string }[]> {
  return database.transaction(async tx => { await authorize(tx, actor, undefined, true); const sales = (await tx.all("sales")).filter(sale => sale.createdAt >= from), saleIds = new Set(sales.map(sale => sale.id)), grouped = new Map<number,{ productId:number; name:string; quantity:number; total:number }>(); for (const line of await tx.all("saleLines")) { if (!saleIds.has(line.saleId)) continue; const x = grouped.get(line.productId) ?? { productId: line.productId, name: line.nameSnapshot, quantity: 0, total: 0 }; x.quantity += num(line.quantity); x.total += num(line.lineTotal); grouped.set(line.productId,x); } return [...grouped.values()].sort((a,b) => b.quantity-a.quantity).slice(0,10).map(x => ({ productId:x.productId, name:x.name, quantity:qty(x.quantity), total:money(x.total) })); });
}

export async function getLocalInventoryReport(actor: Actor) {
  return database.transaction(async tx => {
    await authorize(tx, actor, undefined, true);
    const products = (await tx.all("products")).filter(p => p.active).sort((a, b) => a.name.localeCompare(b.name));
    return {
      productCount: products.length,
      outOfStockCount: products.filter(p => num(p.onHand) <= 0).length,
      inventoryCost: money(products.reduce((sum, p) => sum + num(p.cost) * num(p.onHand), 0)),
      products,
    };
  });
}

export async function getLocalShiftReport(actor: Actor, limit = 50) {
  return database.transaction(async tx => {
    await authorize(tx, actor, undefined, true);
    const [shifts, sales, expenses, employees] = await Promise.all([tx.all("shifts"), tx.all("sales"), tx.all("expenses"), tx.all("employees")]);
    const names = new Map(employees.map(e => [e.id, e.name]));
    const rows = shifts.sort((a, b) => b.startedAt - a.startedAt).slice(0, Math.max(1, Math.min(200, Math.floor(limit))));
    return Promise.all(rows.map(async shift => {
      const shiftSales = sales.filter(s => s.shiftId === shift.id);
      const shiftExpenses = expenses.filter(x => x.shiftId === shift.id);
      const expected = shift.expectedCash ?? money(await cashBalance(tx, shift));
      return {
        ...shift,
        employeeName: names.get(shift.employeeId) ?? "",
        salesCount: shiftSales.length,
        salesTotal: money(shiftSales.reduce((sum, s) => sum + num(s.total), 0)),
        cashExpenses: money(shiftExpenses.filter(x => x.paymentMethod === "cash").reduce((sum, x) => sum + num(x.amount), 0)),
        totalExpenses: money(shiftExpenses.reduce((sum, x) => sum + num(x.amount), 0)),
        expectedCash: expected,
      };
    }));
  });
}

export async function getLocalEmployeeReport(actor: Actor) {
  return database.transaction(async tx => {
    await authorize(tx, actor, undefined, true);
    const since = localDayStart();
    const [employees, attendance, sales, shifts] = await Promise.all([tx.all("employees"), tx.all("attendance"), tx.all("sales"), tx.all("shifts")]);
    return employees.map(employee => {
      const employeeAttendance = attendance.filter(a => a.employeeId === employee.id && a.eventAt >= since).sort((a, b) => b.eventAt - a.eventAt);
      const employeeSales = sales.filter(s => s.employeeId === employee.id && s.createdAt >= since);
      return {
        id: employee.id,
        code: employee.code,
        name: employee.name,
        role: employee.role,
        active: employee.active,
        lastAttendance: employeeAttendance[0] ?? null,
        attendanceCount: employeeAttendance.length,
        salesCount: employeeSales.length,
        salesTotal: money(employeeSales.reduce((sum, s) => sum + num(s.total), 0)),
        openShift: shifts.some(s => s.employeeId === employee.id && s.status === "open"),
      };
    }).sort((a, b) => a.name.localeCompare(b.name));
  });
}
