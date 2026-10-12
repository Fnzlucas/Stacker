import * as node from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { createHash, randomBytes } from './crypto-shim';

describe('crypto-shim (démo navigateur)', () => {
  it('sha256 identique à Node', () => {
    for (const s of ['', 'abc', 'é'.repeat(100), 'x'.repeat(55), 'x'.repeat(56), 'x'.repeat(64)]) {
      expect(createHash('sha256').update(s).digest('hex')).toBe(node.createHash('sha256').update(s).digest('hex'));
      expect(createHash('sha256').update(s).digest('base64url')).toBe(node.createHash('sha256').update(s).digest('base64url'));
    }
  });
  it('randomBytes en hex', () => {
    expect(randomBytes(16).toString('hex')).toMatch(/^[0-9a-f]{32}$/);
  });
});
