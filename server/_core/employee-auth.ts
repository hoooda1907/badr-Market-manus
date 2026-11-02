import { createHash } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import { employeeSessions, employees } from "../../drizzle/schema";
import { getDb } from "../db";

export type EmployeeIdentity = {
  id: number;
  code: string;
  name: string;
  role: "manager" | "cashier" | "stock";
  permissions: string[];
  sessionId: number;
  tokenHash: string;
};

export const rolePermissions: Record<EmployeeIdentity["role"], string[]> = {
  manager: ["*"],
  cashier: ["products:view", "sales:create", "shifts:manage", "attendance:clock"],
  stock: ["products:view", "inventory:view", "inventory:manage", "receipts:create", "attendance:clock"],
};

export function hashEmployeeToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export async function getEmployeeForToken(token: string | undefined): Promise<EmployeeIdentity | null> {
  if (!token || token.length < 24) return null;
  const db = await getDb();
  if (!db) return null;
  const tokenHash = hashEmployeeToken(token);
  const rows = await db
    .select({
      sessionId: employeeSessions.id,
      tokenHash: employeeSessions.tokenHash,
      expiresAt: employeeSessions.expiresAt,
      revokedAt: employeeSessions.revokedAt,
      id: employees.id,
      code: employees.code,
      name: employees.name,
      role: employees.role,
      permissions: employees.permissions,
      active: employees.active,
    })
    .from(employeeSessions)
    .innerJoin(employees, eq(employeeSessions.employeeId, employees.id))
    .where(and(eq(employeeSessions.tokenHash, tokenHash), isNull(employeeSessions.revokedAt)))
    .limit(1);
  const row = rows[0];
  if (!row || row.active !== 1 || row.expiresAt.getTime() <= Date.now()) return null;
  let permissions = rolePermissions[row.role];
  if (row.permissions) {
    try {
      const parsed: unknown = JSON.parse(row.permissions);
      if (Array.isArray(parsed) && parsed.every((item) => typeof item === "string")) {
        permissions = parsed;
      }
    } catch {
      permissions = rolePermissions[row.role];
    }
  }
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    role: row.role,
    permissions,
    sessionId: row.sessionId,
    tokenHash: row.tokenHash,
  };
}

export function employeeHas(employee: EmployeeIdentity, permission: string) {
  return employee.role === "manager" || employee.permissions.includes("*") || employee.permissions.includes(permission);
}
