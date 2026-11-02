export type EmployeeRole = "manager" | "cashier" | "stock";
export type PaymentMethod = "cash" | "card" | "wallet";
export type StockMovementKind = "opening" | "sale" | "receipt" | "count" | "manual";
export type AttendanceEvent = "in" | "out";

export type SecretCredential = {
  algorithm: "PBKDF2-HMAC-SHA256";
  salt: string;
  hash: string;
  iterations: number;
};

export type LocalProduct = {
  id: number;
  externalId: string | null;
  barcode: string | null;
  name: string;
  cost: string;
  price: string;
  onHand: string;
  countedQty: string | null;
  unit: string;
  location: string | null;
  active: boolean;
  createdAt: number;
  updatedAt: number;
};

export type LocalEmployee = {
  id: number;
  code: string;
  name: string;
  role: EmployeeRole;
  phone: string | null;
  pinCredential: SecretCredential | null;
  passwordCredential: SecretCredential | null;
  active: boolean;
  createdAt: number;
};

export type LocalShift = {
  id: number;
  employeeId: number;
  status: "open" | "closed";
  openingCash: string;
  expectedCash: string | null;
  actualCash: string | null;
  difference: string | null;
  startedAt: number;
  closedAt: number | null;
};

export type LocalSale = {
  id: number;
  receiptNo: string;
  employeeId: number;
  shiftId: number;
  subtotal: string;
  discount: string;
  total: string;
  paid: string;
  paymentMethod: PaymentMethod;
  createdAt: number;
};

export type LocalSaleLine = {
  id: number;
  saleId: number;
  productId: number;
  nameSnapshot: string;
  quantity: string;
  price: string;
  cost: string;
  lineTotal: string;
};

export type LocalReceipt = {
  id: number;
  reference: string;
  supplier: string;
  invoiceNo: string | null;
  employeeId: number;
  totalCost: string;
  createdAt: number;
};

export type LocalReceiptLine = {
  id: number;
  receiptId: number;
  productId: number;
  nameSnapshot: string;
  quantity: string;
  cost: string;
  lineTotal: string;
};

export type LocalExpense = {
  id: number;
  category: string;
  description: string;
  amount: string;
  paymentMethod: PaymentMethod;
  shiftId: number | null;
  employeeId: number;
  createdAt: number;
};

export type LocalStockMovement = {
  id: number;
  productId: number;
  employeeId: number | null;
  kind: StockMovementKind;
  quantityDelta: string;
  reference: string | null;
  note: string | null;
  createdAt: number;
};

export type LocalAttendance = {
  id: number;
  employeeId: number;
  event: AttendanceEvent;
  eventAt: number;
  note: string | null;
};

export type LocalTables = {
  products: LocalProduct;
  employees: LocalEmployee;
  shifts: LocalShift;
  sales: LocalSale;
  saleLines: LocalSaleLine;
  receipts: LocalReceipt;
  receiptLines: LocalReceiptLine;
  expenses: LocalExpense;
  stockMovements: LocalStockMovement;
  attendance: LocalAttendance;
};

export type LocalTableName = keyof LocalTables;
export type NewLocalRow<K extends LocalTableName> = Omit<LocalTables[K], "id">;
export type LocalRowPatch<K extends LocalTableName> = Partial<Omit<LocalTables[K], "id">>;

export interface LocalTransaction {
  all<K extends LocalTableName>(table: K): Promise<LocalTables[K][]>;
  get<K extends LocalTableName>(table: K, id: number): Promise<LocalTables[K] | undefined>;
  insert<K extends LocalTableName>(table: K, row: NewLocalRow<K>): Promise<number>;
  update<K extends LocalTableName>(table: K, id: number, patch: LocalRowPatch<K>): Promise<void>;
  delete<K extends LocalTableName>(table: K, id: number): Promise<void>;
}

export interface LocalDatabase {
  initialize(): Promise<void>;
  transaction<T>(operation: (tx: LocalTransaction) => Promise<T>): Promise<T>;
}

export type LocalEmployeeSession = Pick<LocalEmployee, "id" | "code" | "name" | "role">;

export type LocalProductInput = Omit<LocalProduct, "id" | "active" | "createdAt" | "updatedAt">;
