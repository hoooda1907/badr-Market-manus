import AsyncStorage from "@react-native-async-storage/async-storage";
import * as SecureStore from "expo-secure-store";
import type { LocalEmployeeSession } from "@/lib/local-store/types";

const SESSION_KEY = "aswaqbadr.local.employee-id.v1";
const LEGACY_TOKEN_KEY = "aswaqbadr.employee-session";
const LEGACY_EMPLOYEE_KEY = "aswaqbadr.employee";

// Authentication lasts only for the current process/page; IDs are never persisted as login tokens.
let activeEmployeeId: number | null = null;
let legacyCleanup: Promise<void> | null = null;

async function removeLegacySessions(): Promise<void> {
  if (!legacyCleanup) {
    legacyCleanup = (async () => {
      try {
        await AsyncStorage.multiRemove([LEGACY_TOKEN_KEY, LEGACY_EMPLOYEE_KEY]);
      } catch {
        // The old online prototype's storage may not exist on this device.
      }
      try {
        await SecureStore.deleteItemAsync(SESSION_KEY);
      } catch {
        // SecureStore is native-only and may be unavailable in web builds.
      }
      try {
        if (typeof window !== "undefined") {
          window.sessionStorage.removeItem(SESSION_KEY);
          window.localStorage.removeItem(SESSION_KEY);
        }
      } catch {
        // A browser may disable web storage; the new session remains memory-only.
      }
    })();
  }
  await legacyCleanup;
}

export async function getEmployeeId(): Promise<number | null> {
  await removeLegacySessions();
  return activeEmployeeId;
}

export async function setEmployeeSession(employee: LocalEmployeeSession): Promise<void> {
  await removeLegacySessions();
  activeEmployeeId = employee.id;
}

export async function clearEmployeeSession(): Promise<void> {
  activeEmployeeId = null;
  await removeLegacySessions();
}
