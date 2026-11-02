import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { and, desc, eq, gte, like, or, sql } from "drizzle-orm";
import { z } from "zod";
import {
  attendance,
  employeeSessions,
  employees,
  expenses,
  products,
  receiptLines,
  receipts,
  saleLines,
  sales,
  shifts,
  stockMovements,
} from "../drizzle/schema";
import { checkoutSaleInput } from "../shared/sales-contract";
import { getDb } from "./db";
import { employeeHas, hashEmployeeToken, rolePermissions } from "./_core/employee-auth";
import { TRPCError } from "@trpc/server";
import { getSessionCookieName, getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import {
  employeeProcedure,
  managerProcedure,
  permissionProcedure,
  publicProcedure,
  router,
} from "./_core/trpc";

const money = (value: number) => (Math.round((value + Number.EPSILON) * 100) / 100).toFixed(2);
const quantity = (value: number) => (Math.round((value + Number.EPSILON) * 1000) / 1000).toFixed(3);
const requireDb = async () => {
  const db = await getDb();
  if (!db) throw new TRPCError({ code: "SERVICE_UNAVAILABLE", message: "قاعدة البيانات غير متاحة" });
  return db;
};
const pinSchema = z.string().min(4).max(12).regex(/^\d+$/, "الرقم السري يجب أن يتكون من أرقام فقط");
const employeeLoginAttempts = new Map<string, { count: number; blockedUntil: number }>();
const productImportItem = z.object({
  externalId: z.string().max(191).optional().nullable(),
  barcode: z.string().max(64).optional().nullable(),
  name: z.string().trim().min(1).max(255),
  cost: z.number().finite().min(0).default(0),
  price: z.number().finite().min(0).default(0),
  onHand: z.number().finite().default(0),
  countedQty: z.number().finite().optional().nullable(),
  unit: z.string().max(48).default("قطعة"),
  location: z.string().max(128).optional().nullable(),
});
const importProductItem = productImportItem.refine(
  (item) => Boolean(item.externalId?.trim() || item.barcode?.trim()),
  { message: "يلزم المعرف الخارجي أو الباركود لاستيراد الصنف" },
);

export const appRouter = router({
  system: systemRouter,
  auth: router({
    me: publicProcedure.query((opts) => opts.ctx.user),
    logout: publicProcedure.mutation(({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(getSessionCookieName(ctx.req), { ...cookieOptions, maxAge: -1 });
      return { success: true } as const;
    }),
  }),

  employee: router({
    login: publicProcedure
      .input(z.object({ code: z.string().trim().min(1).max(32), pin: pinSchema }))
      .mutation(async ({ input, ctx }) => {
        const attemptKey = `${ctx.req.ip ?? "unknown"}:${input.code}`;
        const attempt = employeeLoginAttempts.get(attemptKey);
        if (attempt && attempt.blockedUntil > Date.now()) {
          throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: "محاولات كثيرة؛ انتظر 10 دقائق ثم حاول مجددًا" });
        }
        const db = await requireDb();
        const rows = await db.select().from(employees).where(eq(employees.code, input.code)).limit(1);
        const employee = rows[0];
        if (!employee || employee.active !== 1) throw new TRPCError({ code: "UNAUTHORIZED", message: "بيانات الدخول غير صحيحة" });
        const supplied = scryptSync(input.pin, employee.pinSalt, 64);
        const expected = Buffer.from(employee.pinHash, "hex");
        if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
          const count = (attempt?.count ?? 0) + 1;
          employeeLoginAttempts.set(attemptKey, { count, blockedUntil: count >= 6 ? Date.now() + 10 * 60 * 1000 : 0 });
          throw new TRPCError({ code: "UNAUTHORIZED", message: "بيانات الدخول غير صحيحة" });
        }
        employeeLoginAttempts.delete(attemptKey);
        const token = randomBytes(32).toString("base64url");
        const expiresAt = new Date(Date.now() + 12 * 60 * 60 * 1000);
        await db.insert(employeeSessions).values({ employeeId: employee.id, tokenHash: hashEmployeeToken(token), expiresAt });
        return {
          token,
          expiresAt,
          employee: { id: employee.id, code: employee.code, name: employee.name, role: employee.role },
        };
      }),
    logout: employeeProcedure.mutation(async ({ ctx }) => {
      const db = await requireDb();
      await db.update(employeeSessions).set({ revokedAt: new Date() }).where(eq(employeeSessions.id, ctx.employee.sessionId));
      return { success: true };
    }),
    list: managerProcedure.query(async () => {
      const db = await requireDb();
      return db.select({ id: employees.id, code: employees.code, name: employees.name, role: employees.role, phone: employees.phone, active: employees.active, createdAt: employees.createdAt }).from(employees).orderBy(employees.name);
    }),
    create: managerProcedure
      .input(z.object({ code: z.string().trim().min(1).max(32), name: z.string().trim().min(2).max(160), role: z.enum(["manager", "cashier", "stock"]), pin: pinSchema, phone: z.string().max(32).optional() }))
      .mutation(async ({ input }) => {
        const db = await requireDb();
        const salt = randomBytes(16).toString("hex");
        const pinHash = scryptSync(input.pin, salt, 64).toString("hex");
        await db.insert(employees).values({ code: input.code, name: input.name, role: input.role, phone: input.phone || null, pinSalt: salt, pinHash, permissions: JSON.stringify(rolePermissions[input.role]) });
        return { success: true };
      }),
    setActive: managerProcedure
      .input(z.object({ id: z.number().int().positive(), active: z.boolean() }))
      .mutation(async ({ input }) => {
        const db = await requireDb();
        await db.update(employees).set({ active: input.active ? 1 : 0 }).where(eq(employees.id, input.id));
        return { success: true };
      }),
  }),

  products: router({
    list: permissionProcedure("products:view")
      .input(z.object({ q: z.string().trim().max(100).default(""), limit: z.number().int().min(1).max(500).default(200) }).optional())
      .query(async ({ input }) => {
        const db = await requireDb();
        const q = input?.q ?? "";
        const filter = q ? or(like(products.name, `%${q}%`), like(products.barcode, `%${q}%`), like(products.externalId, `%${q}%`)) : undefined;
        return db.select().from(products).where(filter ? and(eq(products.active, 1), filter) : eq(products.active, 1)).orderBy(products.name).limit(input?.limit ?? 200);
      }),
    import: managerProcedure
      .input(z.object({ items: z.array(importProductItem).min(1).max(2500) }))
      .mutation(async ({ input }) => {
        const db = await requireDb();
        const imported = await db.transaction(async (tx) => {
          let count = 0;
          for (const item of input.items) {
            const values = {
              externalId: item.externalId?.trim() || null,
              barcode: item.barcode?.trim() || null,
              name: item.name,
              cost: money(item.cost),
              price: money(item.price),
              onHand: quantity(item.onHand),
              countedQty: item.countedQty == null ? null : quantity(item.countedQty),
              unit: item.unit || "قطعة",
              location: item.location?.trim() || null,
            };
            const matches = values.externalId && values.barcode
              ? await tx.select().from(products).where(or(eq(products.externalId, values.externalId), eq(products.barcode, values.barcode))).limit(2)
              : values.externalId
                ? await tx.select().from(products).where(eq(products.externalId, values.externalId)).limit(2)
                : await tx.select().from(products).where(eq(products.barcode, values.barcode!)).limit(2);
            if (matches.length > 1) {
              throw new TRPCError({ code: "CONFLICT", message: "المعرف الخارجي والباركود يشيران إلى صنفين مختلفين؛ صحّح بيانات الصف قبل الاستيراد" });
            }
            const existing = matches[0];
            if (existing) {
              await tx.update(products).set({
                externalId: values.externalId ?? existing.externalId,
                barcode: values.barcode ?? existing.barcode,
                name: values.name,
                cost: values.cost,
                price: values.price,
                onHand: values.onHand,
                countedQty: values.countedQty,
                unit: values.unit,
                location: values.location,
                active: 1,
              }).where(eq(products.id, existing.id));
            } else {
              await tx.insert(products).values(values);
            }
            count++;
          }
          return count;
        });
        return { imported };
      }),
    create: managerProcedure
      .input(productImportItem)
      .mutation(async ({ input }) => {
        const db = await requireDb();
        await db.insert(products).values({ ...input, externalId: input.externalId || null, barcode: input.barcode || null, cost: money(input.cost), price: money(input.price), onHand: quantity(input.onHand), countedQty: input.countedQty == null ? null : quantity(input.countedQty), location: input.location || null });
        return { success: true };
      }),
    setCounted: permissionProcedure("inventory:manage")
      .input(z.object({ id: z.number().int().positive(), countedQty: z.number().finite().min(0) }))
      .mutation(async ({ input, ctx }) => {
        const db = await requireDb();
        await db.transaction(async (tx) => {
          const rows = await tx.select().from(products).where(eq(products.id, input.id)).limit(1);
          if (!rows[0]) throw new TRPCError({ code: "NOT_FOUND", message: "الصنف غير موجود" });
          const delta = input.countedQty - Number(rows[0].onHand);
          await tx.update(products).set({ countedQty: quantity(input.countedQty), onHand: quantity(input.countedQty) }).where(eq(products.id, input.id));
          if (delta !== 0) await tx.insert(stockMovements).values({ productId: input.id, employeeId: ctx.employee.id, kind: "count", quantityDelta: quantity(delta), note: "تسوية جرد فعلي" });
        });
        return { success: true };
      }),
  }),

  inventory: router({
    adjust: permissionProcedure("inventory:manage")
      .input(z.object({ productId: z.number().int().positive(), delta: z.number().finite().refine((v) => v !== 0), note: z.string().max(255).optional() }))
      .mutation(async ({ input, ctx }) => {
        const db = await requireDb();
        await db.transaction(async (tx) => {
          const rows = await tx.select().from(products).where(eq(products.id, input.productId)).limit(1);
          if (!rows[0]) throw new TRPCError({ code: "NOT_FOUND", message: "الصنف غير موجود" });
          const predicate = input.delta < 0
            ? and(eq(products.id, input.productId), gte(products.onHand, quantity(Math.abs(input.delta))))
            : eq(products.id, input.productId);
          const updateResult = await tx.update(products).set({ onHand: sql`${products.onHand} + ${quantity(input.delta)}` }).where(predicate);
          if (!updateResult[0].affectedRows) throw new TRPCError({ code: "BAD_REQUEST", message: "لا يمكن أن يصبح المخزون بالسالب" });
          await tx.insert(stockMovements).values({ productId: input.productId, employeeId: ctx.employee.id, kind: "manual", quantityDelta: quantity(input.delta), note: input.note || null });
        });
        return { success: true };
      }),
    movements: permissionProcedure("inventory:view").query(async () => {
      const db = await requireDb();
      return db.select({ id: stockMovements.id, productId: stockMovements.productId, productName: products.name, kind: stockMovements.kind, quantityDelta: stockMovements.quantityDelta, note: stockMovements.note, createdAt: stockMovements.createdAt }).from(stockMovements).innerJoin(products, eq(stockMovements.productId, products.id)).orderBy(desc(stockMovements.createdAt)).limit(100);
    }),
  }),

  receipts: router({
    create: permissionProcedure("receipts:create")
      .input(z.object({ supplier: z.string().trim().min(1).max(180), invoiceNo: z.string().max(80).optional(), lines: z.array(z.object({ productId: z.number().int().positive(), quantity: z.number().finite().positive(), cost: z.number().finite().min(0) })).min(1).max(300) }))
      .mutation(async ({ input, ctx }) => {
        const db = await requireDb();
        const reference = `GR-${Date.now()}-${randomBytes(2).toString("hex").toUpperCase()}`;
        const receiptId = await db.transaction(async (tx) => {
          let totalCents = 0;
          const prepared: { product: (typeof products.$inferSelect); qty: number; cost: number }[] = [];
          for (const line of input.lines) {
            const rows = await tx.select().from(products).where(eq(products.id, line.productId)).limit(1);
            if (!rows[0]) throw new TRPCError({ code: "NOT_FOUND", message: "يوجد صنف غير موجود في الاستلام" });
            prepared.push({ product: rows[0], qty: line.quantity, cost: line.cost });
            totalCents += Math.round(line.quantity * line.cost * 100);
          }
          const result = await tx.insert(receipts).values({ reference, supplier: input.supplier, invoiceNo: input.invoiceNo || null, employeeId: ctx.employee.id, totalCost: (totalCents / 100).toFixed(2) });
          const newReceiptId = Number(result[0].insertId);
          for (const line of prepared) {
            const value = (Math.round(line.qty * line.cost * 100) / 100).toFixed(2);
            await tx.insert(receiptLines).values({ receiptId: newReceiptId, productId: line.product.id, nameSnapshot: line.product.name, quantity: quantity(line.qty), cost: money(line.cost), lineTotal: value });
            await tx.update(products).set({ onHand: sql`${products.onHand} + ${quantity(line.qty)}`, cost: money(line.cost) }).where(eq(products.id, line.product.id));
            await tx.insert(stockMovements).values({ productId: line.product.id, employeeId: ctx.employee.id, kind: "receipt", quantityDelta: quantity(line.qty), reference, note: input.supplier });
          }
          return newReceiptId;
        });
        return { receiptId, reference };
      }),
    recent: permissionProcedure("inventory:view").query(async () => {
      const db = await requireDb();
      return db.select().from(receipts).orderBy(desc(receipts.createdAt)).limit(50);
    }),
  }),

  expenses: router({
    add: permissionProcedure("accounts:manage")
      .input(z.object({ category: z.string().trim().min(1).max(80), description: z.string().trim().min(1).max(255), amount: z.number().finite().positive(), paymentMethod: z.enum(["cash", "card", "wallet"]).default("cash"), shiftId: z.number().int().positive().optional() }))
      .mutation(async ({ input, ctx }) => {
        const db = await requireDb();
        if (!ctx.employee) throw new TRPCError({ code: "UNAUTHORIZED", message: "سجّل دخول الموظف لحفظ الحركة" });
        if (input.shiftId) {
          const shift = await db.select({ id: shifts.id }).from(shifts).where(and(eq(shifts.id, input.shiftId), eq(shifts.status, "open"))).limit(1);
          if (!shift.length) throw new TRPCError({ code: "BAD_REQUEST", message: "الوردية غير مفتوحة" });
        }
        await db.insert(expenses).values({ category: input.category, description: input.description, amount: money(input.amount), paymentMethod: input.paymentMethod, shiftId: input.shiftId ?? null, employeeId: ctx.employee.id });
        return { success: true };
      }),
    recent: permissionProcedure("accounts:manage").query(async () => {
      const db = await requireDb();
      return db.select({ id: expenses.id, category: expenses.category, description: expenses.description, amount: expenses.amount, paymentMethod: expenses.paymentMethod, shiftId: expenses.shiftId, createdAt: expenses.createdAt, employeeName: employees.name }).from(expenses).innerJoin(employees, eq(expenses.employeeId, employees.id)).orderBy(desc(expenses.createdAt)).limit(100);
    }),
  }),

  shifts: router({
    current: employeeProcedure.query(async ({ ctx }) => {
      const db = await requireDb();
      const rows = await db.select().from(shifts).where(and(eq(shifts.employeeId, ctx.employee.id), eq(shifts.status, "open"))).orderBy(desc(shifts.startedAt)).limit(1);
      return rows[0] ?? null;
    }),
    open: permissionProcedure("shifts:manage")
      .input(z.object({ openingCash: z.number().finite().min(0).default(0) }))
      .mutation(async ({ input, ctx }) => {
        const db = await requireDb();
        const openRows = await db.select({ id: shifts.id }).from(shifts).where(and(eq(shifts.employeeId, ctx.employee.id), eq(shifts.status, "open"))).limit(1);
        if (openRows.length) throw new TRPCError({ code: "CONFLICT", message: "لديك وردية مفتوحة بالفعل" });
        const result = await db.insert(shifts).values({ employeeId: ctx.employee.id, openingCash: money(input.openingCash) });
        return { id: Number(result[0].insertId) };
      }),
    close: permissionProcedure("shifts:manage")
      .input(z.object({ id: z.number().int().positive(), actualCash: z.number().finite().min(0) }))
      .mutation(async ({ input, ctx }) => {
        const db = await requireDb();
        const shiftRows = await db.select().from(shifts).where(and(eq(shifts.id, input.id), eq(shifts.employeeId, ctx.employee.id), eq(shifts.status, "open"))).limit(1);
        if (!shiftRows[0]) throw new TRPCError({ code: "NOT_FOUND", message: "الوردية المفتوحة غير موجودة" });
        const saleRows = await db.select({ total: sales.total, paymentMethod: sales.paymentMethod }).from(sales).where(eq(sales.shiftId, input.id));
        const cashSales = saleRows.filter((sale) => sale.paymentMethod === "cash").reduce((sum, sale) => sum + Number(sale.total), 0);
        const expenseRows = await db.select({ amount: expenses.amount, paymentMethod: expenses.paymentMethod }).from(expenses).where(eq(expenses.shiftId, input.id));
        const cashExpenses = expenseRows.filter((expense) => expense.paymentMethod === "cash").reduce((sum, expense) => sum + Number(expense.amount), 0);
        const expected = Number(shiftRows[0].openingCash) + cashSales - cashExpenses;
        const difference = input.actualCash - expected;
        await db.update(shifts).set({ status: "closed", expectedCash: money(expected), actualCash: money(input.actualCash), difference: money(difference), closedAt: new Date() }).where(eq(shifts.id, input.id));
        return { expected: money(expected), difference: money(difference) };
      }),
  }),

  sales: router({
    checkout: permissionProcedure("sales:create")
      .input(checkoutSaleInput)
      .mutation(async ({ input, ctx }) => {
        const db = await requireDb();
        const result = await db.transaction(async (tx) => {
          let subtotalCents = 0;
          const prepared: { product: (typeof products.$inferSelect); qty: number; lineCents: number }[] = [];
          for (const line of input.lines) {
            const rows = await tx.select().from(products).where(and(eq(products.id, line.productId), eq(products.active, 1))).limit(1);
            if (!rows[0]) throw new TRPCError({ code: "NOT_FOUND", message: "يوجد صنف غير متاح في الفاتورة" });
            if (Number(rows[0].onHand) < line.quantity) throw new TRPCError({ code: "BAD_REQUEST", message: `الكمية غير كافية للصنف ${rows[0].name}` });
            const lineCents = Math.round(Number(rows[0].price) * line.quantity * 100);
            subtotalCents += lineCents;
            prepared.push({ product: rows[0], qty: line.quantity, lineCents });
          }
          const discountCents = Math.round(input.discount * 100);
          if (discountCents > subtotalCents) throw new TRPCError({ code: "BAD_REQUEST", message: "الخصم أكبر من قيمة الفاتورة" });
          if (discountCents > 0 && !employeeHas(ctx.employee, "sales:discount")) throw new TRPCError({ code: "FORBIDDEN", message: "لا تملك صلاحية الخصم" });
          const totalCents = subtotalCents - discountCents;
          if (Math.round(input.paid * 100) < totalCents) throw new TRPCError({ code: "BAD_REQUEST", message: "المبلغ المدفوع أقل من الإجمالي" });
          const shiftId = input.shiftId;
          const openShift = await tx.select({ id: shifts.id }).from(shifts).where(and(eq(shifts.id, shiftId), eq(shifts.employeeId, ctx.employee.id), eq(shifts.status, "open"))).limit(1);
          if (!openShift.length) throw new TRPCError({ code: "BAD_REQUEST", message: "الوردية غير مفتوحة لهذا الموظف" });
          const receiptNo = `BD-${Date.now()}-${randomBytes(3).toString("hex").toUpperCase()}`;
          const saleResult = await tx.insert(sales).values({ receiptNo, employeeId: ctx.employee.id, shiftId: shiftId ?? null, subtotal: (subtotalCents / 100).toFixed(2), discount: (discountCents / 100).toFixed(2), total: (totalCents / 100).toFixed(2), paid: money(input.paid), paymentMethod: input.paymentMethod });
          const saleId = Number(saleResult[0].insertId);
          for (const line of prepared) {
            await tx.insert(saleLines).values({ saleId, productId: line.product.id, nameSnapshot: line.product.name, quantity: quantity(line.qty), price: line.product.price, cost: line.product.cost, lineTotal: (line.lineCents / 100).toFixed(2) });
            const stockUpdate = await tx.update(products).set({ onHand: sql`${products.onHand} - ${quantity(line.qty)}` }).where(and(eq(products.id, line.product.id), gte(products.onHand, quantity(line.qty))));
            if (!stockUpdate[0].affectedRows) throw new TRPCError({ code: "BAD_REQUEST", message: `الكمية غير كافية للصنف ${line.product.name}` });
            await tx.insert(stockMovements).values({ productId: line.product.id, employeeId: ctx.employee.id, kind: "sale", quantityDelta: quantity(-line.qty), reference: receiptNo });
          }
          return { saleId, receiptNo, total: (totalCents / 100).toFixed(2) };
        });
        return result;
      }),
    recent: permissionProcedure("reports:view").query(async () => {
      const db = await requireDb();
      return db.select().from(sales).orderBy(desc(sales.createdAt)).limit(100);
    }),
  }),

  attendance: router({
    clock: permissionProcedure("attendance:clock").mutation(async ({ ctx }) => {
      const db = await requireDb();
      const startOfDay = new Date();
      startOfDay.setHours(0, 0, 0, 0);
      const previous = await db.select().from(attendance).where(and(eq(attendance.employeeId, ctx.employee.id), gte(attendance.eventAt, startOfDay))).orderBy(desc(attendance.eventAt)).limit(1);
      const event = previous[0]?.event === "in" ? "out" : "in";
      await db.insert(attendance).values({ employeeId: ctx.employee.id, event });
      return { event, eventAt: new Date() };
    }),
    recent: managerProcedure.query(async () => {
      const db = await requireDb();
      return db.select({ id: attendance.id, employeeId: attendance.employeeId, employeeName: employees.name, event: attendance.event, eventAt: attendance.eventAt }).from(attendance).innerJoin(employees, eq(attendance.employeeId, employees.id)).orderBy(desc(attendance.eventAt)).limit(100);
    }),
  }),

  reports: router({
    summary: permissionProcedure("reports:view")
      .input(z.object({ from: z.date().optional() }).optional())
      .query(async ({ input }) => {
        const db = await requireDb();
        const from = input?.from ?? new Date(new Date().setHours(0, 0, 0, 0));
        const rows = await db.select({ total: sales.total, paid: sales.paid, paymentMethod: sales.paymentMethod }).from(sales).where(gte(sales.createdAt, from));
        const expenseRows = await db.select({ amount: expenses.amount }).from(expenses).where(gte(expenses.createdAt, from));
        const purchaseRows = await db.select({ totalCost: receipts.totalCost }).from(receipts).where(gte(receipts.createdAt, from));
        const lineRows = await db.select({ revenue: saleLines.lineTotal, cost: saleLines.cost, quantity: saleLines.quantity }).from(saleLines).innerJoin(sales, eq(saleLines.saleId, sales.id)).where(gte(sales.createdAt, from));
        const total = rows.reduce((sum, row) => sum + Number(row.total), 0);
        const expenseTotal = expenseRows.reduce((sum, row) => sum + Number(row.amount), 0);
        const purchaseTotal = purchaseRows.reduce((sum, row) => sum + Number(row.totalCost), 0);
        const grossProfit = lineRows.reduce((sum, row) => sum + Number(row.revenue) - Number(row.cost) * Number(row.quantity), 0);
        return { count: rows.length, total: money(total), cash: money(rows.filter((row) => row.paymentMethod === "cash").reduce((sum, row) => sum + Number(row.total), 0)), expenses: money(expenseTotal), purchases: money(purchaseTotal), grossProfit: money(grossProfit), net: money(grossProfit - expenseTotal) };
      }),
    bestSellers: permissionProcedure("reports:view").query(async () => {
      const db = await requireDb();
      const startOfDay = new Date();
      startOfDay.setHours(0, 0, 0, 0);
      const rows = await db.select({ productId: saleLines.productId, name: saleLines.nameSnapshot, quantity: sql<string>`sum(${saleLines.quantity})`, total: sql<string>`sum(${saleLines.lineTotal})` }).from(saleLines).innerJoin(sales, eq(saleLines.saleId, sales.id)).where(gte(sales.createdAt, startOfDay)).groupBy(saleLines.productId, saleLines.nameSnapshot).orderBy(desc(sql`sum(${saleLines.quantity})`)).limit(10);
      return rows;
    }),
  }),
});

export type AppRouter = typeof appRouter;
