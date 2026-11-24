// Canonical JSON and SHA-256, written out so the protocol stays runtime-neutral and synchronous:
// no Node crypto, no Web Crypto, no TextEncoder. The coordinator uses the hash to tell a true
// retry (same request ID, same content) from a reused ID with different content (invariant 5).

/**
 * Serializes a JSON value with object keys sorted by UTF-16 code unit, no whitespace, and
 * properties whose value is `undefined` dropped. For JSON input this matches RFC 8785 (JCS).
 * Throws on values JSON cannot represent: non-finite numbers, bigint, functions, symbols,
 * `undefined` array entries and objects that are not plain.
 */
export function canonicalJson(value: unknown): string {
  return serialize(value, 0);
}

/** Nesting this deep is far beyond any valid command; refuse rather than overflow the stack. */
const MAX_CANONICAL_DEPTH = 256;

function serialize(value: unknown, depth: number): string {
  if (depth > MAX_CANONICAL_DEPTH) throw new RangeError('value is nested too deeply to hash');
  if (value === null || typeof value === 'boolean' || typeof value === 'string') {
    return JSON.stringify(value);
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError('non-finite number cannot be hashed');
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value
      .map((item: unknown) => {
        if (item === undefined) throw new TypeError('undefined array entry cannot be hashed');
        return serialize(item, depth + 1);
      })
      .join(',')}]`;
  }
  if (typeof value === 'object') {
    const proto: unknown = Object.getPrototypeOf(value);
    if (proto !== Object.prototype && proto !== null) {
      throw new TypeError('only plain objects can be hashed');
    }
    const record = value as Record<string, unknown>;
    const parts: string[] = [];
    for (const key of Object.keys(record).sort()) {
      const item = record[key];
      if (item !== undefined) parts.push(`${JSON.stringify(key)}:${serialize(item, depth + 1)}`);
    }
    return `{${parts.join(',')}}`;
  }
  throw new TypeError(`${typeof value} cannot be hashed`);
}

/** Lowercase hex SHA-256 of the value's canonical JSON. Key order never changes the result. */
export function canonicalPayloadHash(value: unknown): string {
  return sha256Hex(utf8Encode(canonicalJson(value)));
}

/** Number of bytes `text` occupies as UTF-8. Lone surrogates count as U+FFFD (3 bytes). */
export function utf8Length(text: string): number {
  let bytes = 0;
  for (let i = 0; i < text.length; i++) {
    const unit = text.charCodeAt(i);
    if (unit < 0x80) bytes += 1;
    else if (unit < 0x800) bytes += 2;
    else if (isHighSurrogate(unit) && i + 1 < text.length && isLowSurrogate(text.charCodeAt(i + 1))) {
      bytes += 4;
      i++;
    } else bytes += 3;
  }
  return bytes;
}

/** UTF-8 bytes of `text`. Lone surrogates become U+FFFD. */
export function utf8Encode(text: string): Uint8Array {
  const out = new Uint8Array(utf8Length(text));
  let p = 0;
  for (let i = 0; i < text.length; i++) {
    let code = text.charCodeAt(i);
    if (isHighSurrogate(code) && i + 1 < text.length && isLowSurrogate(text.charCodeAt(i + 1))) {
      code = 0x10000 + ((code - 0xd800) << 10) + (text.charCodeAt(i + 1) - 0xdc00);
      i++;
    } else if (code >= 0xd800 && code <= 0xdfff) {
      code = 0xfffd;
    }
    if (code < 0x80) {
      out[p++] = code;
    } else if (code < 0x800) {
      out[p++] = 0xc0 | (code >> 6);
      out[p++] = 0x80 | (code & 0x3f);
    } else if (code < 0x10000) {
      out[p++] = 0xe0 | (code >> 12);
      out[p++] = 0x80 | ((code >> 6) & 0x3f);
      out[p++] = 0x80 | (code & 0x3f);
    } else {
      out[p++] = 0xf0 | (code >> 18);
      out[p++] = 0x80 | ((code >> 12) & 0x3f);
      out[p++] = 0x80 | ((code >> 6) & 0x3f);
      out[p++] = 0x80 | (code & 0x3f);
    }
  }
  return out;
}

function isHighSurrogate(unit: number): boolean {
  return unit >= 0xd800 && unit <= 0xdbff;
}

function isLowSurrogate(unit: number): boolean {
  return unit >= 0xdc00 && unit <= 0xdfff;
}

// FIPS 180-4 round constants.
const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98,
  0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786,
  0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8,
  0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
  0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819,
  0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a,
  0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7,
  0xc67178f2,
]);

const rotr = (x: number, n: number): number => (x >>> n) | (x << (32 - n));

/** Lowercase hex SHA-256 digest (FIPS 180-4). */
export function sha256Hex(message: Uint8Array): string {
  const h = new Uint32Array([
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ]);
  // Pad: one 0x80 byte, zeros, then the bit length as a 64-bit big-endian integer.
  const total = Math.ceil((message.length + 9) / 64) * 64;
  const block = new Uint8Array(total);
  block.set(message);
  block[message.length] = 0x80;
  const view = new DataView(block.buffer);
  const bits = message.length * 8;
  view.setUint32(total - 8, Math.floor(bits / 0x100000000));
  view.setUint32(total - 4, bits >>> 0);

  const w = new Uint32Array(64);
  for (let offset = 0; offset < total; offset += 64) {
    for (let i = 0; i < 16; i++) w[i] = view.getUint32(offset + i * 4);
    for (let i = 16; i < 64; i++) {
      const w15 = w[i - 15]!;
      const w2 = w[i - 2]!;
      const s0 = rotr(w15, 7) ^ rotr(w15, 18) ^ (w15 >>> 3);
      const s1 = rotr(w2, 17) ^ rotr(w2, 19) ^ (w2 >>> 10);
      w[i] = (w[i - 16]! + s0 + w[i - 7]! + s1) | 0;
    }
    let a = h[0]!;
    let b = h[1]!;
    let c = h[2]!;
    let d = h[3]!;
    let e = h[4]!;
    let f = h[5]!;
    let g = h[6]!;
    let hh = h[7]!;
    for (let i = 0; i < 64; i++) {
      const s1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const t1 = (hh + s1 + ch + K[i]! + w[i]!) | 0;
      const s0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (s0 + maj) | 0;
      hh = g;
      g = f;
      f = e;
      e = (d + t1) | 0;
      d = c;
      c = b;
      b = a;
      a = (t1 + t2) | 0;
    }
    h[0] = h[0]! + a;
    h[1] = h[1]! + b;
    h[2] = h[2]! + c;
    h[3] = h[3]! + d;
    h[4] = h[4]! + e;
    h[5] = h[5]! + f;
    h[6] = h[6]! + g;
    h[7] = h[7]! + hh;
  }
  let hex = '';
  for (const word of h) hex += word.toString(16).padStart(8, '0');
  return hex;
}
