import * as SQLite from "expo-sqlite";
import type {
  LocalDatabase,
  LocalTableName,
  LocalTables,
  LocalTransaction,
  NewLocalRow,
  LocalRowPatch,
} from "./types";

const DATABASE_NAME = "aswaq_badr_local.db";

const schema: Record<LocalTableName, string> = {
  products: `CREATE TABLE IF NOT EXISTS products (id INTEGER PRIMARY KEY AUTOINCREMENT, externalId TEXT, barcode TEXT, name TEXT NOT NULL, cost TEXT NOT NULL, price TEXT NOT NULL, onHand TEXT NOT NULL, countedQty TEXT, unit TEXT NOT NULL, location TEXT, active INTEGER NOT NULL, createdAt INTEGER NOT NULL, updatedAt INTEGER NOT NULL)`,
  employees: `CREATE TABLE IF NOT EXISTS employees (id INTEGER PRIMARY KEY AUTOINCREMENT, code TEXT NOT NULL UNIQUE, name TEXT NOT NULL, role TEXT NOT NULL, phone TEXT, pinCredential TEXT, passwordCredential TEXT, active INTEGER NOT NULL, createdAt INTEGER NOT NULL)`,
  shifts: `CREATE TABLE IF NOT EXISTS shifts (id INTEGER PRIMARY KEY AUTOINCREMENT, employeeId INTEGER NOT NULL REFERENCES employees(id), status TEXT NOT NULL, openingCash TEXT NOT NULL, expectedCash TEXT, actualCash TEXT, difference TEXT, startedAt INTEGER NOT NULL, closedAt INTEGER)`,
  sales: `CREATE TABLE IF NOT EXISTS sales (id INTEGER PRIMARY KEY AUTOINCREMENT, receiptNo TEXT NOT NULL UNIQUE, employeeId INTEGER NOT NULL REFERENCES employees(id), shiftId INTEGER NOT NULL REFERENCES shifts(id), subtotal TEXT NOT NULL, discount TEXT NOT NULL, total TEXT NOT NULL, paid TEXT NOT NULL, paymentMethod TEXT NOT NULL, createdAt INTEGER NOT NULL)`,
  saleLines: `CREATE TABLE IF NOT EXISTS saleLines (id INTEGER PRIMARY KEY AUTOINCREMENT, saleId INTEGER NOT NULL REFERENCES sales(id) ON DELETE CASCADE, productId INTEGER NOT NULL REFERENCES products(id), nameSnapshot TEXT NOT NULL, quantity TEXT NOT NULL, price TEXT NOT NULL, cost TEXT NOT NULL, lineTotal TEXT NOT NULL)`,
  receipts: `CREATE TABLE IF NOT EXISTS receipts (id INTEGER PRIMARY KEY AUTOINCREMENT, reference TEXT NOT NULL UNIQUE, supplier TEXT NOT NULL, invoiceNo TEXT, employeeId INTEGER NOT NULL REFERENCES employees(id), totalCost TEXT NOT NULL, createdAt INTEGER NOT NULL)`,
  receiptLines: `CREATE TABLE IF NOT EXISTS receiptLines (id INTEGER PRIMARY KEY AUTOINCREMENT, receiptId INTEGER NOT NULL REFERENCES receipts(id) ON DELETE CASCADE, productId INTEGER NOT NULL REFERENCES products(id), nameSnapshot TEXT NOT NULL, quantity TEXT NOT NULL, cost TEXT NOT NULL, lineTotal TEXT NOT NULL)`,
  expenses: `CREATE TABLE IF NOT EXISTS expenses (id INTEGER PRIMARY KEY AUTOINCREMENT, category TEXT NOT NULL, description TEXT NOT NULL, amount TEXT NOT NULL, paymentMethod TEXT NOT NULL, shiftId INTEGER REFERENCES shifts(id), employeeId INTEGER NOT NULL REFERENCES employees(id), createdAt INTEGER NOT NULL)`,
  stockMovements: `CREATE TABLE IF NOT EXISTS stockMovements (id INTEGER PRIMARY KEY AUTOINCREMENT, productId INTEGER NOT NULL REFERENCES products(id), employeeId INTEGER REFERENCES employees(id), kind TEXT NOT NULL, quantityDelta TEXT NOT NULL, reference TEXT, note TEXT, createdAt INTEGER NOT NULL)`,
  attendance: `CREATE TABLE IF NOT EXISTS attendance (id INTEGER PRIMARY KEY AUTOINCREMENT, employeeId INTEGER NOT NULL REFERENCES employees(id), event TEXT NOT NULL, eventAt INTEGER NOT NULL, note TEXT)`,
};

const dateFields = new Set(["createdAt", "updatedAt", "startedAt", "closedAt", "eventAt"]);
const boolFields = new Set(["active"]);
const credentialFields = new Set(["pinCredential", "passwordCredential"]);

function toDatabaseValue(key: string, value: unknown): SQLite.SQLiteBindValue {
  if (credentialFields.has(key)) return value == null ? null : JSON.stringify(value);
  if (boolFields.has(key)) return value ? 1 : 0;
  if (value === undefined) return null;
  return value as SQLite.SQLiteBindValue;
}

function fromDatabaseRow<K extends LocalTableName>(table: K, source: Record<string, unknown>): LocalTables[K] {
  const row = { ...source };
  for (const field of dateFields) if (field in row && row[field] != null) row[field] = Number(row[field]);
  for (const field of boolFields) if (field in row) row[field] = Boolean(row[field]);
  for (const field of credentialFields) {
    if (field in row && typeof row[field] === "string") row[field] = JSON.parse(row[field] as string);
  }
  return row as LocalTables[K];
}

function makeTransaction(database: SQLite.SQLiteDatabase): LocalTransaction {
  return {
    async all<K extends LocalTableName>(table: K): Promise<LocalTables[K][]> {
      const rows = await database.getAllAsync<Record<string, unknown>>(`SELECT * FROM "${table}"`);
      return rows.map((row) => fromDatabaseRow(table, row));
    },
    async get<K extends LocalTableName>(table: K, id: number): Promise<LocalTables[K] | undefined> {
      const row = await database.getFirstAsync<Record<string, unknown>>(`SELECT * FROM "${table}" WHERE id = ?`, id);
      return row ? fromDatabaseRow(table, row) : undefined;
    },
    async insert<K extends LocalTableName>(table: K, row: NewLocalRow<K>): Promise<number> {
      const entries = Object.entries(row as Record<string, unknown>);
      const columns = entries.map(([key]) => `"${key}"`).join(", ");
      const placeholders = entries.map(() => "?").join(", ");
      const values = entries.map(([key, value]) => toDatabaseValue(key, value));
      const result = await database.runAsync(`INSERT INTO "${table}" (${columns}) VALUES (${placeholders})`, ...values);
      return result.lastInsertRowId;
    },
    async update<K extends LocalTableName>(table: K, id: number, patch: LocalRowPatch<K>): Promise<void> {
      const entries = Object.entries(patch as Record<string, unknown>);
      if (!entries.length) return;
      const assignments = entries.map(([key]) => `"${key}" = ?`).join(", ");
      const values = entries.map(([key, value]) => toDatabaseValue(key, value));
      await database.runAsync(`UPDATE "${table}" SET ${assignments} WHERE id = ?`, ...values, id);
    },
    async delete<K extends LocalTableName>(table: K, id: number): Promise<void> {
      await database.runAsync(`DELETE FROM "${table}" WHERE id = ?`, id);
    },
  };
}

let databasePromise: Promise<SQLite.SQLiteDatabase> | undefined;
async function getDatabase(): Promise<SQLite.SQLiteDatabase> {
  if (!databasePromise) {
    databasePromise = (async () => {
      const db = await SQLite.openDatabaseAsync(DATABASE_NAME);
      await db.execAsync("PRAGMA foreign_keys = ON;");
      for (const sql of Object.values(schema)) await db.execAsync(sql);
      await db.execAsync(`
        CREATE INDEX IF NOT EXISTS idx_products_barcode ON products(barcode);
        CREATE INDEX IF NOT EXISTS idx_shifts_employee_status ON shifts(employeeId, status);
        CREATE INDEX IF NOT EXISTS idx_sales_createdAt ON sales(createdAt);
        CREATE INDEX IF NOT EXISTS idx_saleLines_saleId ON saleLines(saleId);
        CREATE INDEX IF NOT EXISTS idx_receiptLines_receiptId ON receiptLines(receiptId);
        CREATE INDEX IF NOT EXISTS idx_expenses_createdAt ON expenses(createdAt);
        CREATE INDEX IF NOT EXISTS idx_stockMovements_product_createdAt ON stockMovements(productId, createdAt);
        CREATE INDEX IF NOT EXISTS idx_attendance_employee_eventAt ON attendance(employeeId, eventAt);
      `);
      return db;
    })();
  }
  return databasePromise;
}

export const localDatabase: LocalDatabase = {
  async initialize(): Promise<void> {
    await getDatabase();
  },
  async transaction<T>(operation: (tx: LocalTransaction) => Promise<T>): Promise<T> {
    const db = await getDatabase();
    let result!: T;
    await db.withExclusiveTransactionAsync(async (sqliteTransaction) => {
      result = await operation(makeTransaction(sqliteTransaction as unknown as SQLite.SQLiteDatabase));
    });
    return result;
  },
};
