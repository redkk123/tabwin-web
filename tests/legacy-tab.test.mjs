import assert from 'node:assert/strict';
import test from 'node:test';
import {
  diffLegacyTabInspections,
  inspectLegacyTab,
  legacyTabHexWindow,
} from '../dist/packages/formats/src/legacy-tab.js';

test('legacy TAB inspector identifies OLE CFB and extracts path evidence without claiming replay', () => {
  const signature = Uint8Array.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
  const text = new TextEncoder().encode('xxxxC:\\TABWIN\\RD2008.DEF\0CNV\\NATJUR.CNV\0RDAC2401.dbc\0');
  const bytes = new Uint8Array(signature.length + text.length);
  bytes.set(signature, 0); bytes.set(text, signature.length);
  const inspection = inspectLegacyTab(bytes);
  assert.equal(inspection.containerHint, 'ole-cfb');
  assert.equal(inspection.replay.status, 'inspection-only');
  assert.ok(inspection.replay.blockers.length >= 3);
  assert.deepEqual(inspection.references.map((item) => item.kind), ['def', 'cnv', 'dbc']);
});

test('legacy TAB inspector finds embedded UTF-16LE evidence and diffs controlled captures', () => {
  const encodeUtf16 = (value) => {
    const bytes = new Uint8Array(value.length * 2);
    for (let index = 0; index < value.length; index++) bytes[index * 2] = value.charCodeAt(index);
    return bytes;
  };
  const before = inspectLegacyTab(encodeUtf16('C:\\TABWIN\\A.DEF'));
  const after = inspectLegacyTab(encodeUtf16('C:\\TABWIN\\B.DEF'));
  assert.equal(before.references[0]?.encoding, 'utf-16le');
  const diff = diffLegacyTabInspections(before, after);
  assert.deepEqual(diff.removedReferences.map((item) => item.value), ['C:\\TABWIN\\A.DEF']);
  assert.deepEqual(diff.addedReferences.map((item) => item.value), ['C:\\TABWIN\\B.DEF']);
});

test('legacy TAB hex window is bounded and offset-labelled', () => {
  const bytes = Uint8Array.from({ length: 64 }, (_, index) => index);
  const window = legacyTabHexWindow(bytes, 32, 16);
  assert.match(window, /^00000010/m);
  assert.match(window, /00000020/m);
  assert.throws(() => legacyTabHexWindow(bytes, 100), /outside/);
});
