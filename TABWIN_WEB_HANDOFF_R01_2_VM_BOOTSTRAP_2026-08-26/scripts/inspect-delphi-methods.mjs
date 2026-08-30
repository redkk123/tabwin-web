/**
 * Recovers Delphi published-method tables from a 32-bit VCL executable.
 *
 * A published method entry is laid out as:
 *   Word    size      - total entry size, including this field
 *   Pointer address   - the method's code address (a virtual address)
 *   ShortString name  - one length byte followed by that many characters
 *
 * So for a name that starts at file offset N with length L stored at N-1,
 * the code address is the little-endian dword at N-5, and the entry size is
 * the word at N-7. Both are checked against the name length before an entry is
 * accepted, which is what keeps ordinary strings out of the result.
 */

import { readFile } from 'node:fs/promises';

const NAME = /^[A-Za-z_][A-Za-z0-9_]{2,63}$/;

function parsePeSections(bytes, view) {
  const peOffset = view.getUint32(0x3c, true);
  const sectionCount = view.getUint16(peOffset + 6, true);
  const optionalSize = view.getUint16(peOffset + 20, true);
  const imageBase = view.getUint32(peOffset + 24 + 28, true);
  const first = peOffset + 24 + optionalSize;
  const sections = [];
  for (let index = 0; index < sectionCount; index++) {
    const at = first + index * 40;
    sections.push({
      name: Buffer.from(bytes.subarray(at, at + 8)).toString('latin1').replace(/\0+$/, ''),
      virtualSize: view.getUint32(at + 8, true),
      virtualAddress: view.getUint32(at + 12, true),
      rawSize: view.getUint32(at + 16, true),
      rawOffset: view.getUint32(at + 20, true),
    });
  }
  return { imageBase, sections };
}

function fileOffsetToVirtual(offset, imageBase, sections) {
  for (const section of sections) {
    if (offset >= section.rawOffset && offset < section.rawOffset + section.rawSize) {
      return imageBase + section.virtualAddress + (offset - section.rawOffset);
    }
  }
  return undefined;
}

function virtualToFileOffset(address, imageBase, sections) {
  const relative = address - imageBase;
  for (const section of sections) {
    if (relative >= section.virtualAddress && relative < section.virtualAddress + section.virtualSize) {
      return section.rawOffset + (relative - section.virtualAddress);
    }
  }
  return undefined;
}

const bytes = new Uint8Array(await readFile(process.argv[2]));
const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
const { imageBase, sections } = parsePeSections(bytes, view);

const entries = [];
for (let offset = 8; offset < bytes.length - 2; offset++) {
  const length = bytes[offset - 1];
  if (length < 3 || length > 63 || offset + length > bytes.length) continue;
  const name = Buffer.from(bytes.subarray(offset, offset + length)).toString('latin1');
  if (!NAME.test(name)) continue;
  const size = view.getUint16(offset - 7, true);
  // size covers the word, the pointer and the whole ShortString.
  if (size !== 2 + 4 + 1 + length) continue;
  const address = view.getUint32(offset - 5, true);
  if (virtualToFileOffset(address, imageBase, sections) === undefined) continue;
  entries.push({
    name,
    address,
    tableOffset: offset - 7,
    tableVirtual: fileOffsetToVirtual(offset - 7, imageBase, sections),
  });
}

// Entries of one class sit next to each other; a gap means a different table.
entries.sort((a, b) => a.tableOffset - b.tableOffset);
const groups = [];
let current = null;
for (const entry of entries) {
  if (!current || entry.tableOffset - current.end > 64) {
    current = { start: entry.tableOffset, end: entry.tableOffset, methods: [] };
    groups.push(current);
  }
  current.end = entry.tableOffset + 7 + entry.name.length;
  current.methods.push(entry);
}

const wanted = process.argv[3] ? new RegExp(process.argv[3], 'i') : null;
let shown = 0;
console.log(`imageBase 0x${imageBase.toString(16)} · ${entries.length} métodos publicados em ${groups.length} tabelas`);
for (const group of groups) {
  if (wanted && !group.methods.some((method) => wanted.test(method.name))) continue;
  if (group.methods.length < 2) continue;
  console.log(`\n--- tabela em 0x${group.start.toString(16)} (${group.methods.length} métodos) ---`);
  for (const method of group.methods) {
    console.log(`  ${method.name.padEnd(34)} 0x${method.address.toString(16).toUpperCase().padStart(8, '0')}`);
  }
  if (++shown >= Number(process.argv[4] ?? 6)) break;
}
