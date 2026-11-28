// Coordinator-issued IDs and recovery epochs. Random, never derived from client input.
import { formatId, type IdKind } from '@consort/protocol';

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
/** 24 base-62 characters: about 143 bits. */
const LENGTH = 24;

export function randomBody(length = LENGTH): string {
  let body = '';
  while (body.length < length) {
    for (const byte of crypto.getRandomValues(new Uint8Array(length * 2))) {
      // 248 is the largest multiple of 62 below 256; rejecting the rest keeps the draw unbiased.
      if (byte < 248 && body.length < length) body += ALPHABET[byte % 62];
    }
  }
  return body;
}

export function newId(kind: IdKind): string {
  return formatId(kind, randomBody());
}
