import { beforeEach, describe, expect, it, vi } from "vitest";
import { clearEmployeeSession, getEmployeeId, setEmployeeSession } from "../lib/employee-session";

const mocks = vi.hoisted(() => ({
  multiRemove: vi.fn(async () => undefined),
  secureDelete: vi.fn(async () => undefined),
  asyncSetItem: vi.fn(async () => undefined),
  secureSetItem: vi.fn(async () => undefined),
}));

vi.mock("@react-native-async-storage/async-storage", () => ({
  default: { multiRemove: mocks.multiRemove, setItem: mocks.asyncSetItem },
}));
vi.mock("expo-secure-store", () => ({
  deleteItemAsync: mocks.secureDelete,
  setItemAsync: mocks.secureSetItem,
}));

describe("local employee session", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    await clearEmployeeSession();
    vi.clearAllMocks();
  });

  it("keeps the active employee in memory and never persists an auto-login token", async () => {
    await setEmployeeSession({ id: 12, code: "MGR12", name: "مدير", role: "manager" });
    await expect(getEmployeeId()).resolves.toBe(12);
    expect(mocks.asyncSetItem).not.toHaveBeenCalled();
    expect(mocks.secureSetItem).not.toHaveBeenCalled();

    await clearEmployeeSession();
    await expect(getEmployeeId()).resolves.toBeNull();
    expect(mocks.secureSetItem).not.toHaveBeenCalled();
  });
});
