export interface TabWinBiffLabelCell {
  row: number;
  column: number;
  value: string;
}

export interface TabWinBiffNumberCell {
  row: number;
  column: number;
  value: number;
}

export interface TabWinBiffTable {
  labels: TabWinBiffLabelCell[];
  numbers: TabWinBiffNumberCell[];
}

/**
 * Reads the compact BIFF stream produced by TabWin 4.15's XLS export.
 * Only LABEL (0x0204) and NUMBER (0x0203) records are interpreted; every
 * record boundary is still validated so truncated evidence cannot pass.
 */
export function parseTabWinBiffExport(
  bytes: Uint8Array,
  decoder = new TextDecoder('windows-1252'),
): TabWinBiffTable {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const labels: TabWinBiffLabelCell[] = [];
  const numbers: TabWinBiffNumberCell[] = [];
  let offset = 0;

  while (offset + 4 <= bytes.byteLength) {
    const opcode = view.getUint16(offset, true);
    const length = view.getUint16(offset + 2, true);
    const payload = offset + 4;
    if (payload + length > bytes.byteLength) {
      throw new Error(`truncated BIFF record at byte ${offset}`);
    }

    if (opcode === 0x0204 && length >= 8) {
      const row = view.getUint16(payload, true);
      const column = view.getUint16(payload + 2, true);
      const stringLength = view.getUint16(payload + 6, true);
      if (8 + stringLength > length) {
        throw new Error(`invalid BIFF label length at byte ${offset}`);
      }
      labels.push({
        row,
        column,
        value: decoder.decode(bytes.subarray(payload + 8, payload + 8 + stringLength)),
      });
    }

    if (opcode === 0x0203 && length >= 14) {
      numbers.push({
        row: view.getUint16(payload, true),
        column: view.getUint16(payload + 2, true),
        value: view.getFloat64(payload + 6, true),
      });
    }

    offset = payload + length;
  }

  if (offset !== bytes.byteLength) throw new Error(`trailing partial BIFF header at byte ${offset}`);
  return { labels, numbers };
}
