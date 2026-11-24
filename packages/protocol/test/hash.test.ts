import { describe, expect, it } from 'vitest';

import { canonicalJson, canonicalPayloadHash, sha256Hex, utf8Encode, utf8Length } from '../src/index.js';

const hex = (bytes: Uint8Array) => [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
const ascii = (text: string) => utf8Encode(text);

describe('canonicalPayloadHash', () => {
  it('hash is stable across key order', () => {
    const a = { b: 1, a: { d: [1, { y: 2, x: 1 }], c: 'é' } };
    const b = { a: { c: 'é', d: [1, { x: 1, y: 2 }] }, b: 1 };
    expect(canonicalPayloadHash(a)).toBe(canonicalPayloadHash(b));
    expect(canonicalJson(a)).toBe('{"a":{"c":"é","d":[1,{"x":1,"y":2}]},"b":1}');
  });

  it('changes when content changes, including type', () => {
    expect(canonicalPayloadHash({ a: 1 })).not.toBe(canonicalPayloadHash({ a: 2 }));
    expect(canonicalPayloadHash({ a: 1 })).not.toBe(canonicalPayloadHash({ a: '1' }));
    expect(canonicalPayloadHash([1, 2])).not.toBe(canonicalPayloadHash([2, 1]));
  });

  it('drops undefined properties like JSON does', () => {
    expect(canonicalJson({ a: 1, b: undefined })).toBe('{"a":1}');
  });

  it('refuses values JSON cannot represent', () => {
    expect(() => canonicalJson({ a: Number.NaN })).toThrow(TypeError);
    expect(() => canonicalJson({ a: Number.POSITIVE_INFINITY })).toThrow(TypeError);
    expect(() => canonicalJson({ a: 1n })).toThrow(TypeError);
    expect(() => canonicalJson({ a: new Date(0) })).toThrow(TypeError);
    expect(() => canonicalJson([undefined])).toThrow(TypeError);
  });
});

describe('sha256Hex', () => {
  // FIPS 180-4 / NIST example vectors.
  it.each([
    ['', 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'],
    ['abc', 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'],
    [
      'abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq',
      '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1',
    ],
  ])('matches the published digest of %j', (input, digest) => {
    expect(sha256Hex(ascii(input))).toBe(digest);
  });

  it('matches the published digest of one million "a"', () => {
    expect(sha256Hex(ascii('a'.repeat(1_000_000)))).toBe(
      'cdc76e5c9914fb9281a1c7e284d73e67f1809a48a497200e046d39ccc7112cd0',
    );
  });

  it('handles messages around the 55/56/64-byte padding boundaries', () => {
    const digests = new Set([55, 56, 63, 64, 65].map((n) => sha256Hex(ascii('x'.repeat(n)))));
    expect(digests.size).toBe(5);
    for (const digest of digests) expect(digest).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('utf8', () => {
  it('encodes one- to four-byte characters', () => {
    expect(hex(utf8Encode('aé€😀'))).toBe('61c3a9e282acf09f9880');
    expect(utf8Length('aé€😀')).toBe(10);
  });

  it('replaces a lone surrogate with U+FFFD', () => {
    expect(hex(utf8Encode('\ud800'))).toBe('efbfbd');
    expect(utf8Length('\ud800')).toBe(3);
  });
});
