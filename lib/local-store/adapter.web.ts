import { Dexie, type Table, type UpdateSpec } from "dexie";
import type {
  LocalDatabase,
  LocalRowPatch,
  LocalTableName,
  LocalTables,
  LocalTransaction,
  NewLocalRow,
} from "./types";

const schema = {
  products: "++id, barcode, externalId, name",
  employees: "++id, &code, name",
  shifts: "++id, employeeId, status, startedAt",
  sales: "++id, &receiptNo, employeeId, shiftId, createdAt",
  saleLines: "++id, saleId, productId",
  receipts: "++id, &reference, invoiceNo, employeeId, createdAt",
  receiptLines: "++id, receiptId, productId",
  expenses: "++id, category, shiftId, employeeId, createdAt",
  stockMovements: "++id, productId, employeeId, kind, reference, createdAt",
  attendance: "++id, employeeId, event, eventAt",
} satisfies Record<LocalTableName, string>;

class AswaqbadrLocalDatabase extends Dexie {
  constructor() {
    super("aswaqbadr-local");
    this.version(1).stores(schema);
  }

  tableFor<K extends LocalTableName>(name: K): Table<LocalTables[K], number> {
    return this.table(name) as Table<LocalTables[K], number>;
  }
}

const db = new AswaqbadrLocalDatabase();
const names = Object.keys(schema) as LocalTableName[];

async function assertInvoiceNoAvailable(
  invoiceNo: string | null,
  exceptId?: number,
): Promise<void> {
  if (invoiceNo === null) return;
  const matching = await db.tableFor("receipts").where("invoiceNo").equals(invoiceNo).toArray();
  if (matching.some((receipt) => receipt.id !== exceptId)) {
    throw new Error(`Duplicate receipt invoice number: ${invoiceNo}`);
  }
}

const localDatabase: LocalDatabase = {
  async initialize() {
    await db.open();
  },

  async transaction<T>(operation: (tx: LocalTransaction) => Promise<T>): Promise<T> {
    await db.open();
    return db.transaction("rw", names.map((name) => db.table(name)), async () => {
      const tx: LocalTransaction = {
        all: <K extends LocalTableName>(table: K) => db.tableFor(table).toArray(),
        get: <K extends LocalTableName>(table: K, id: number) => db.tableFor(table).get(id),
        insert: async <K extends LocalTableName>(table: K, row: NewLocalRow<K>) => {
          if (table === "receipts") {
            await assertInvoiceNoAvailable((row as NewLocalRow<"receipts">).invoiceNo);
          }
          return db.tableFor(table).add(row as LocalTables[K]);
        },
        update: async <K extends LocalTableName>(table: K, id: number, patch: LocalRowPatch<K>) => {
          if (table === "receipts" && "invoiceNo" in patch) {
            await assertInvoiceNoAvailable((patch as LocalRowPatch<"receipts">).invoiceNo ?? null, id);
          }
          await db.tableFor(table).update(id, patch as unknown as UpdateSpec<LocalTables[K]>);
        },
        delete: async <K extends LocalTableName>(table: K, id: number) => {
          await db.tableFor(table).delete(id);
        },
      };
      return operation(tx);
    });
  },
};

export { localDatabase };
