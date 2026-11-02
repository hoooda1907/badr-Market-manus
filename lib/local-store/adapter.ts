import type { LocalDatabase, LocalTransaction } from "./types";

/** Metro replaces this module with adapter.native.ts or adapter.web.ts in supported app builds. */
export const localDatabase: LocalDatabase = {
  async initialize() {
    throw new Error("No local database adapter exists for this platform.");
  },
  async transaction<T>(_operation: (tx: LocalTransaction) => Promise<T>): Promise<T> {
    throw new Error("No local database adapter exists for this platform.");
  },
};
