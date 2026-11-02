import {
  decimal,
  index,
  int,
  mysqlEnum,
  mysqlTable,
  text,
  timestamp,
  uniqueIndex,
  varchar,
} from "drizzle-orm/mysql-core";

export const users = mysqlTable("users", {
  id: int("id").autoincrement().primaryKey(),
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  loginMethod: varchar("loginMethod", { length: 64 }),
  role: mysqlEnum("role", ["user", "admin"]).default("user").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull(),
});
export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;

export const products = mysqlTable(
  "products",
  {
    id: int("id").autoincrement().primaryKey(),
    externalId: varchar("externalId", { length: 191 }),
    barcode: varchar("barcode", { length: 64 }),
    name: varchar("name", { length: 255 }).notNull(),
    cost: decimal("cost", { precision: 12, scale: 2 }).default("0.00").notNull(),
    price: decimal("price", { precision: 12, scale: 2 }).default("0.00").notNull(),
    onHand: decimal("onHand", { precision: 14, scale: 3 }).default("0.000").notNull(),
    countedQty: decimal("countedQty", { precision: 14, scale: 3 }),
    unit: varchar("unit", { length: 48 }).default("قطعة").notNull(),
    location: varchar("location", { length: 128 }),
    active: int("active").default(1).notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  (t) => [uniqueIndex("products_external_id_uq").on(t.externalId), uniqueIndex("products_barcode_uq").on(t.barcode), index("products_name_idx").on(t.name)],
);
export type Product = typeof products.$inferSelect;

export const employees = mysqlTable(
  "employees",
  {
    id: int("id").autoincrement().primaryKey(),
    code: varchar("code", { length: 32 }).notNull(),
    name: varchar("name", { length: 160 }).notNull(),
    role: mysqlEnum("role", ["manager", "cashier", "stock"]).default("cashier").notNull(),
    permissions: text("permissions"),
    pinSalt: varchar("pinSalt", { length: 64 }).notNull(),
    pinHash: varchar("pinHash", { length: 128 }).notNull(),
    phone: varchar("phone", { length: 32 }),
    active: int("active").default(1).notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  (t) => [uniqueIndex("employees_code_uq").on(t.code), index("employees_active_idx").on(t.active)],
);
export type Employee = typeof employees.$inferSelect;

export const employeeSessions = mysqlTable(
  "employee_sessions",
  {
    id: int("id").autoincrement().primaryKey(),
    employeeId: int("employeeId").notNull().references(() => employees.id),
    tokenHash: varchar("tokenHash", { length: 64 }).notNull().unique(),
    expiresAt: timestamp("expiresAt").notNull(),
    revokedAt: timestamp("revokedAt"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  (t) => [index("employee_sessions_employee_idx").on(t.employeeId)],
);

export const shifts = mysqlTable(
  "shifts",
  {
    id: int("id").autoincrement().primaryKey(),
    employeeId: int("employeeId").notNull().references(() => employees.id),
    status: mysqlEnum("status", ["open", "closed"]).default("open").notNull(),
    openingCash: decimal("openingCash", { precision: 12, scale: 2 }).default("0.00").notNull(),
    expectedCash: decimal("expectedCash", { precision: 12, scale: 2 }),
    actualCash: decimal("actualCash", { precision: 12, scale: 2 }),
    difference: decimal("difference", { precision: 12, scale: 2 }),
    startedAt: timestamp("startedAt").defaultNow().notNull(),
    closedAt: timestamp("closedAt"),
  },
  (t) => [index("shifts_status_idx").on(t.status), index("shifts_employee_idx").on(t.employeeId)],
);

export const sales = mysqlTable(
  "sales",
  {
    id: int("id").autoincrement().primaryKey(),
    receiptNo: varchar("receiptNo", { length: 40 }).notNull(),
    employeeId: int("employeeId").notNull().references(() => employees.id),
    shiftId: int("shiftId").references(() => shifts.id),
    subtotal: decimal("subtotal", { precision: 14, scale: 2 }).notNull(),
    discount: decimal("discount", { precision: 12, scale: 2 }).default("0.00").notNull(),
    total: decimal("total", { precision: 14, scale: 2 }).notNull(),
    paid: decimal("paid", { precision: 14, scale: 2 }).notNull(),
    paymentMethod: mysqlEnum("paymentMethod", ["cash", "card", "wallet"]).default("cash").notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  (t) => [uniqueIndex("sales_receipt_no_uq").on(t.receiptNo), index("sales_created_idx").on(t.createdAt), index("sales_employee_idx").on(t.employeeId)],
);

export const saleLines = mysqlTable(
  "sale_lines",
  {
    id: int("id").autoincrement().primaryKey(),
    saleId: int("saleId").notNull().references(() => sales.id),
    productId: int("productId").notNull().references(() => products.id),
    nameSnapshot: varchar("nameSnapshot", { length: 255 }).notNull(),
    quantity: decimal("quantity", { precision: 14, scale: 3 }).notNull(),
    price: decimal("price", { precision: 12, scale: 2 }).notNull(),
    cost: decimal("cost", { precision: 12, scale: 2 }).notNull(),
    lineTotal: decimal("lineTotal", { precision: 14, scale: 2 }).notNull(),
  },
  (t) => [index("sale_lines_sale_idx").on(t.saleId), index("sale_lines_product_idx").on(t.productId)],
);

export const receipts = mysqlTable(
  "goods_receipts",
  {
    id: int("id").autoincrement().primaryKey(),
    reference: varchar("reference", { length: 48 }).notNull().unique(),
    supplier: varchar("supplier", { length: 180 }).notNull(),
    invoiceNo: varchar("invoiceNo", { length: 80 }),
    employeeId: int("employeeId").notNull().references(() => employees.id),
    totalCost: decimal("totalCost", { precision: 14, scale: 2 }).notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  (t) => [index("goods_receipts_created_idx").on(t.createdAt)],
);

export const receiptLines = mysqlTable("goods_receipt_lines", {
  id: int("id").autoincrement().primaryKey(),
  receiptId: int("receiptId").notNull().references(() => receipts.id),
  productId: int("productId").notNull().references(() => products.id),
  nameSnapshot: varchar("nameSnapshot", { length: 255 }).notNull(),
  quantity: decimal("quantity", { precision: 14, scale: 3 }).notNull(),
  cost: decimal("cost", { precision: 12, scale: 2 }).notNull(),
  lineTotal: decimal("lineTotal", { precision: 14, scale: 2 }).notNull(),
});

export const expenses = mysqlTable(
  "expenses",
  {
    id: int("id").autoincrement().primaryKey(),
    category: varchar("category", { length: 80 }).notNull(),
    description: varchar("description", { length: 255 }).notNull(),
    amount: decimal("amount", { precision: 14, scale: 2 }).notNull(),
    paymentMethod: mysqlEnum("paymentMethod", ["cash", "card", "wallet"]).default("cash").notNull(),
    shiftId: int("shiftId").references(() => shifts.id),
    employeeId: int("employeeId").notNull().references(() => employees.id),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  (t) => [index("expenses_created_idx").on(t.createdAt), index("expenses_shift_idx").on(t.shiftId)],
);

export const stockMovements = mysqlTable(
  "stock_movements",
  {
    id: int("id").autoincrement().primaryKey(),
    productId: int("productId").notNull().references(() => products.id),
    employeeId: int("employeeId").references(() => employees.id),
    kind: mysqlEnum("kind", ["opening", "sale", "receipt", "count", "manual"]).notNull(),
    quantityDelta: decimal("quantityDelta", { precision: 14, scale: 3 }).notNull(),
    reference: varchar("reference", { length: 48 }),
    note: varchar("note", { length: 255 }),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  (t) => [index("stock_movements_product_idx").on(t.productId), index("stock_movements_created_idx").on(t.createdAt)],
);

export const attendance = mysqlTable(
  "attendance",
  {
    id: int("id").autoincrement().primaryKey(),
    employeeId: int("employeeId").notNull().references(() => employees.id),
    event: mysqlEnum("event", ["in", "out"]).notNull(),
    eventAt: timestamp("eventAt").defaultNow().notNull(),
    note: varchar("note", { length: 255 }),
  },
  (t) => [index("attendance_employee_idx").on(t.employeeId), index("attendance_event_at_idx").on(t.eventAt)],
);
