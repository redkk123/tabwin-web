import type { DbfField, DbfRecord } from '@precisa-saude/datasus-dbc';

export interface WriteDbfOptions {
  dateOfLastUpdate?: Date;
}

const WINDOWS_1252 = new Map<number, number>([
  [0x20ac, 0x80], [0x201a, 0x82], [0x0192, 0x83], [0x201e, 0x84], [0x2026, 0x85],
  [0x2020, 0x86], [0x2021, 0x87], [0x02c6, 0x88], [0x2030, 0x89], [0x0160, 0x8a],
  [0x2039, 0x8b], [0x0152, 0x8c], [0x017d, 0x8e], [0x2018, 0x91], [0x2019, 0x92],
  [0x201c, 0x93], [0x201d, 0x94], [0x2022, 0x95], [0x2013, 0x96], [0x2014, 0x97],
  [0x02dc, 0x98], [0x2122, 0x99], [0x0161, 0x9a], [0x203a, 0x9b], [0x0153, 0x9c],
  [0x017e, 0x9e], [0x0178, 0x9f],
]);

function encodeWindows1252(value: string): Uint8Array {
  const bytes: number[] = [];
  for (const char of value) {
    const code = char.codePointAt(0)!;
    bytes.push(code <= 0x7f || (code >= 0xa0 && code <= 0xff) ? code : WINDOWS_1252.get(code) ?? 0x3f);
  }
  return Uint8Array.from(bytes);
}

function uniqueFieldNames(fields: readonly DbfField[]): string[] {
  const used = new Set<string>();
  return fields.map((field, index) => {
    const base = field.name.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/[^A-Za-z0-9_]/g, '_').toUpperCase().slice(0, 10) || `CAMPO${index + 1}`;
    let candidate = base;
    let suffix = 1;
    while (used.has(candidate)) {
      const end = String(++suffix);
      candidate = `${base.slice(0, 10 - end.length)}${end}`;
    }
    used.add(candidate);
    return candidate;
  });
}

function formatDate(value: unknown): string {
  const date = value instanceof Date ? value : new Date(String(value));
  if (!Number.isFinite(date.getTime())) throw new Error(`invalid DBF date value: ${String(value)}`);
  return `${date.getUTCFullYear()}${String(date.getUTCMonth() + 1).padStart(2, '0')}${String(date.getUTCDate()).padStart(2, '0')}`;
}

function textForField(value: unknown, field: DbfField): Uint8Array {
  if (value === null || value === undefined || value === '') return new Uint8Array();
  if (field.type === 'C') return encodeWindows1252(String(value));
  if (field.type === 'D') return encodeWindows1252(formatDate(value));
  if (field.type === 'L') return encodeWindows1252(value === true ? 'T' : value === false ? 'F' : '?');
  if (field.type === 'N' || field.type === 'F') {
    const number = typeof value === 'number' ? value : Number(String(value).replace(',', '.'));
    if (!Number.isFinite(number)) throw new Error(`invalid numeric DBF value in ${field.name}`);
    return encodeWindows1252(field.decimalCount > 0 ? number.toFixed(field.decimalCount) : String(Math.trunc(number)));
  }
  return new Uint8Array();
}

export function writeDbf(records: readonly DbfRecord[], fields: readonly DbfField[], options: WriteDbfOptions = {}): Uint8Array {
  if (!fields.length) throw new Error('DBF output requires at least one field');
  if (fields.length > 2046) throw new Error('DBF output exceeds the field limit');
  for (const field of fields) {
    if (!Number.isInteger(field.length) || field.length < 1 || field.length > 254
      || !Number.isInteger(field.decimalCount) || field.decimalCount < 0 || field.decimalCount >= field.length
      || !new Set(['C', 'N', 'F', 'D', 'L', 'I']).has(field.type)) {
      throw new Error(`unsupported DBF field descriptor: ${field.name}`);
    }
    if (field.type === 'D' && field.length !== 8) throw new Error(`DBF date field ${field.name} must have length 8`);
    if (field.type === 'L' && field.length !== 1) throw new Error(`DBF logical field ${field.name} must have length 1`);
    if (field.type === 'I' && field.length !== 4) throw new Error(`DBF integer field ${field.name} must have length 4`);
  }
  const headerLength = 32 + fields.length * 32 + 1;
  const recordLength = 1 + fields.reduce((sum, field) => sum + field.length, 0);
  if (recordLength > 65_535) throw new Error('DBF record width exceeds the format limit');
  if (records.length > 0xffff_ffff) throw new Error('DBF record count exceeds the format limit');
  const totalLength = headerLength + records.length * recordLength + 1;
  if (!Number.isSafeInteger(totalLength) || totalLength > 2_147_483_647) throw new Error('DBF output is too large');
  const output = new Uint8Array(totalLength);
  output.fill(0x20, headerLength, headerLength + records.length * recordLength);
  const view = new DataView(output.buffer);
  const date = options.dateOfLastUpdate ?? new Date();
  if (!Number.isFinite(date.getTime())) throw new Error('invalid DBF update date');
  output[0] = 0x03;
  output[1] = date.getUTCFullYear() - 1900;
  output[2] = date.getUTCMonth() + 1;
  output[3] = date.getUTCDate();
  view.setUint32(4, records.length, true);
  view.setUint16(8, headerLength, true);
  view.setUint16(10, recordLength, true);
  output[29] = 0x03;
  const fieldNames = uniqueFieldNames(fields);
  for (let index = 0; index < fields.length; index++) {
    const field = fields[index]!;
    const offset = 32 + index * 32;
    output.set(encodeWindows1252(fieldNames[index]!).slice(0, 10), offset);
    output[offset + 11] = field.type.charCodeAt(0);
    output[offset + 16] = field.length;
    output[offset + 17] = field.decimalCount;
  }
  output[headerLength - 1] = 0x0d;

  for (let rowIndex = 0; rowIndex < records.length; rowIndex++) {
    const record = records[rowIndex]!;
    let offset = headerLength + rowIndex * recordLength;
    output[offset++] = 0x20;
    for (const field of fields) {
      if (field.type === 'I') {
        const raw = record[field.name];
        const number = raw === null || raw === undefined || raw === '' ? 0 : Number(raw);
        if (!Number.isInteger(number) || number < -2_147_483_648 || number > 2_147_483_647) {
          throw new Error(`invalid integer DBF value in ${field.name}`);
        }
        view.setInt32(offset, number, true);
      } else {
        const encoded = textForField(record[field.name], field);
        if (encoded.length > field.length) throw new Error(`DBF value exceeds width ${field.length} in ${field.name}`);
        const rightAligned = field.type === 'N' || field.type === 'F';
        output.set(encoded, offset + (rightAligned ? field.length - encoded.length : 0));
      }
      offset += field.length;
    }
  }
  output[output.length - 1] = 0x1a;
  return output;
}
