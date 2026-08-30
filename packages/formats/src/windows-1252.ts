/**
 * Windows-1252 encoder, the write-side counterpart to the `TextDecoder`
 * calls already used throughout this package (`map-parser.ts`,
 * `tabwin-biff.ts`) and in `apps/web/src/main.ts`. The web platform only
 * ships a decoder for legacy encodings — `TextEncoder` is UTF-8 only — so
 * writing a `.CNV`/`.DEF` back out in the encoding TabWin 4.15 itself reads
 * needs this.
 *
 * Table matches the WHATWG Encoding Standard's windows-1252 index exactly,
 * so `encodeWindows1252(new TextDecoder('windows-1252').decode(bytes))`
 * round-trips every one of the 256 possible input bytes byte-for-byte —
 * verified in `tests/windows-1252.test.mjs` against all 256 values, not a
 * sample.
 */

/** Bytes 0x80-0x9F that do not decode to their own code point. Every byte
 *  outside this table (0x00-0x7F, 0xA0-0xFF, and the five bytes cp1252
 *  leaves unassigned inside 0x80-0x9F) decodes to the identical code point,
 *  and this codec treats that as encode-able too — the same behavior a
 *  `TextDecoder('windows-1252')` round trip needs on the way back. */
const CP1252_HIGH_BYTE_TO_CODEPOINT: Record<number, number> = {
  0x80: 0x20ac, 0x82: 0x201a, 0x83: 0x0192, 0x84: 0x201e, 0x85: 0x2026,
  0x86: 0x2020, 0x87: 0x2021, 0x88: 0x02c6, 0x89: 0x2030, 0x8a: 0x0160,
  0x8b: 0x2039, 0x8c: 0x0152, 0x8e: 0x017d, 0x91: 0x2018, 0x92: 0x2019,
  0x93: 0x201c, 0x94: 0x201d, 0x95: 0x2022, 0x96: 0x2013, 0x97: 0x2014,
  0x98: 0x02dc, 0x99: 0x2122, 0x9a: 0x0161, 0x9b: 0x203a, 0x9c: 0x0153,
  0x9e: 0x017e, 0x9f: 0x0178,
};

let codepointToByte: Map<number, number> | null = null;

function reverseTable(): Map<number, number> {
  if (codepointToByte) return codepointToByte;
  const map = new Map<number, number>();
  for (let byte = 0; byte < 0x100; byte++) map.set(byte, byte);
  for (const [byteText, codepoint] of Object.entries(CP1252_HIGH_BYTE_TO_CODEPOINT)) {
    const byte = Number(byteText);
    map.delete(byte);
    map.set(codepoint, byte);
  }
  codepointToByte = map;
  return map;
}

/**
 * Encodes `text` as Windows-1252. Throws on the first character with no
 * Windows-1252 representation — silently substituting `?` would corrupt a
 * CNV label without any visible sign, which is worse than refusing to save.
 */
export function encodeWindows1252(text: string): Uint8Array {
  const reverse = reverseTable();
  const bytes = new Uint8Array(text.length);
  for (let index = 0; index < text.length; index++) {
    const codepoint = text.codePointAt(index)!;
    const byte = reverse.get(codepoint);
    if (byte === undefined) {
      const hex = codepoint.toString(16).toUpperCase().padStart(4, '0');
      throw new RangeError(`character "${text[index]}" (U+${hex}) at index ${index} has no Windows-1252 representation`);
    }
    bytes[index] = byte;
  }
  return bytes;
}
