import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import {
  generateActivationCode as genMjs,
  normalizeActivationCode as normMjs,
  sha256Hex as shaMjs,
} from './bootstrap-admin.mjs';
import {
  generateActivationCode as genTs,
  normalizeActivationCode as normTs,
  sha256Hex as shaTs,
} from '../worker/auth/tokens';

// The .mjs script cannot import TypeScript, so it mirrors the token
// primitives. These tests pin the mirror to the source of truth: if
// worker/auth/tokens.ts changes its alphabet, length, format, or hashing,
// this suite fails before an admin bootstrap can issue an unusable code.

const readSource = (rel: string) => fs.readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

function extractConstants(source: string) {
  const alphabet = source.match(/CODE_ALPHABET\s*=\s*'([^']+)'/)?.[1];
  const length = source.match(/CODE_LENGTH\s*=\s*(\d+)/)?.[1];
  return { alphabet, length };
}

const tsSource = readSource('../worker/auth/tokens.ts');
const mjsSource = readSource('./bootstrap-admin.mjs');
const tsConsts = extractConstants(tsSource);
const mjsConsts = extractConstants(mjsSource);

describe('bootstrap-admin ↔ tokens.ts parity', () => {
  it('declares the same CODE_ALPHABET and CODE_LENGTH in both sources', () => {
    expect(tsConsts.alphabet).toBeTruthy();
    expect(mjsConsts.alphabet).toBe(tsConsts.alphabet);
    expect(mjsConsts.length).toBe(tsConsts.length);
  });

  it('generates codes in the identical XXXX-XXXX-XX shape', () => {
    const alphabet = tsConsts.alphabet!;
    const pattern = new RegExp(`^[${alphabet}]{4}-[${alphabet}]{4}-[${alphabet}]{2}$`);
    for (let i = 0; i < 200; i++) {
      expect(genMjs()).toMatch(pattern);
      expect(genTs()).toMatch(pattern);
    }
  });

  it('emits only the unambiguous alphabet characters (no I/L/O/U/0/1)', () => {
    for (let i = 0; i < 200; i++) {
      const body = normMjs(genMjs());
      expect(body).toHaveLength(Number(tsConsts.length));
      expect(body).not.toMatch(/[ILOU01]/);
      expect(body).toMatch(new RegExp(`^[${tsConsts.alphabet!}]+$`));
    }
  });

  it('normalizes identically: uppercase, separators and junk stripped', () => {
    const vectors = [
      'abc-def-ghj',
      ' ABCD EFGH JK ',
      'abcd-efgh-jk',
      'AbCd-EfGh-Jk',
      '',
      undefined as unknown as string,
      '****',
    ];
    for (const v of vectors) {
      expect(normMjs(v)).toBe(normTs(v));
    }
    expect(normMjs('abcd-efgh-jk')).toBe('ABCDEFGHJK');
    expect(normMjs('****')).toBe('');
  });

  it('hashes the canonical (normalized) form identically to the TS implementation', async () => {
    // Only the SHA-256 of the normalized code may ever be stored — the script
    // must agree with store.ts's redeemActivationCode comparison input.
    const code = genMjs();
    const normalized = normMjs(code);
    expect(normalized).toHaveLength(Number(mjsConsts.length));
    expect(await shaMjs(normalized)).toBe(await shaTs(normalized));
    // Dashes must not reach the hash: raw vs normalized digests differ.
    expect(await shaMjs(code)).not.toBe(await shaMjs(normalized));
  });

  it('matches published SHA-256 vectors (createHash is not silently broken)', async () => {
    expect(shaMjs('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    expect(await shaTs('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    expect(shaMjs('ABCDEFGHJK')).toBe(
      'f57cbf1e3e471b25db4b8ad0844df41b2dae9c7d1944944d128e49294d412f66',
    );
    // Cross-impl agreement over a broader input set.
    for (const input of ['', 'a', 'ABCDEFGHJK', genMjs(), 'unicode-کیس']) {
      expect(shaMjs(input)).toBe(await shaTs(input));
    }
  });
});
