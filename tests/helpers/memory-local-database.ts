import type {
  LocalDatabase,
  LocalRowPatch,
  LocalTableName,
  LocalTables,
  LocalTransaction,
  NewLocalRow,
} from "../../lib/local-store/types";

type Store = { [K in LocalTableName]: LocalTables[K][] };
type Sequences = Record<LocalTableName, number>;
const tableNames: LocalTableName[] = ["products", "employees", "shifts", "sales", "saleLines", "receipts", "receiptLines", "expenses", "stockMovements", "attendance"];

function emptyStore(): Store {
  return Object.fromEntries(tableNames.map((name) => [name, []])) as unknown as Store;
}
function emptySequences(): Sequences {
  return Object.fromEntries(tableNames.map((name) => [name, 0])) as Sequences;
}

/** Transactional in-memory adapter exclusively for deterministic local-service tests. */
export class MemoryLocalDatabase implements LocalDatabase {
  private rows = emptyStore();
  private sequences = emptySequences();

  async initialize(): Promise<void> {}

  async transaction<T>(operation: (tx: LocalTransaction) => Promise<T>): Promise<T> {
    const draft = structuredClone(this.rows);
    const ids = { ...this.sequences };
    const tx: LocalTransaction = {
      all: async <K extends LocalTableName>(table: K) => structuredClone(draft[table]),
      get: async <K extends LocalTableName>(table: K, id: number) => {
        const row = draft[table].find((candidate) => candidate.id === id);
        return row ? structuredClone(row) : undefined;
      },
      insert: async <K extends LocalTableName>(table: K, row: NewLocalRow<K>) => {
        const id = ++ids[table];
        (draft[table] as LocalTables[K][]).push({ ...structuredClone(row), id } as LocalTables[K]);
        return id;
      },
      update: async <K extends LocalTableName>(table: K, id: number, patch: LocalRowPatch<K>) => {
        const rows = draft[table] as LocalTables[K][];
        const index = rows.findIndex((row) => row.id === id);
        if (index >= 0) rows[index] = { ...rows[index], ...structuredClone(patch) };
      },
      delete: async <K extends LocalTableName>(table: K, id: number) => {
        const rows = draft[table] as LocalTables[K][];
        const index = rows.findIndex((row) => row.id === id);
        if (index >= 0) rows.splice(index, 1);
      },
    };
    const result = await operation(tx);
    this.rows = draft;
    this.sequences = ids;
    return result;
  }

  async snapshot<K extends LocalTableName>(table: K): Promise<LocalTables[K][]> {
    return structuredClone(this.rows[table]);
  }
}
