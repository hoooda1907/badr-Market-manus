import { beforeEach, describe, expect, it, vi } from 'vitest';
import { deriveLocalSecret, verifyLocalSecret } from '../shared/local-security';

let saltSequence = 0;
vi.mock('expo-crypto', () => ({
  getRandomBytesAsync: async (length: number) => {
    saltSequence += 1;
    return Uint8Array.from({ length }, (_, index) => (saltSequence + index) & 0xff);
  },
}));

describe('local secret credentials', () => {
  const testIterations = 1_000;

  beforeEach(() => {
    saltSequence = 0;
  });

  it('verifies the correct secret', async () => {
    const credential = await deriveLocalSecret('test-only secret value', testIterations);
    expect(await verifyLocalSecret('test-only secret value', credential)).toBe(true);
  });

  it('rejects a different secret', async () => {
    const credential = await deriveLocalSecret('test-only secret value', testIterations);
    expect(await verifyLocalSecret('not the same secret', credential)).toBe(false);
  });

  it('uses distinct random salts for otherwise identical secrets', async () => {
    const first = await deriveLocalSecret('test-only secret value', testIterations);
    const second = await deriveLocalSecret('test-only secret value', testIterations);
    expect(first.salt).not.toBe(second.salt);
    expect(first.hash).not.toBe(second.hash);
    expect(await verifyLocalSecret('test-only secret value', second)).toBe(true);
  });

  it('fails closed for malformed credentials', async () => {
    const valid = await deriveLocalSecret('test-only secret value', testIterations);
    const malformed = [
      null,
      {},
      { ...valid, algorithm: 'SHA-256' },
      { ...valid, salt: 'bad salt' },
      { ...valid, hash: '00' },
      { ...valid, iterations: -1 },
      { ...valid, iterations: 10_000_001 },
    ];

    for (const credential of malformed) {
      expect(await verifyLocalSecret('test-only secret value', credential as never)).toBe(false);
    }
  });
});
