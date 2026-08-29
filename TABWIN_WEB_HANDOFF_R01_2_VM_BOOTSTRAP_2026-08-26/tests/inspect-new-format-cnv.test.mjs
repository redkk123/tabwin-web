import assert from 'node:assert/strict';
import test from 'node:test';
import { inspectNewFormatCnvText } from '../scripts/inspect-new-format-cnv.mjs';

function row(prefix, sequence, label, codes) {
  return `${String(prefix).padStart(5)}${String(sequence).padStart(4)}  ${label.padEnd(100).slice(0, 100)} ${codes}`;
}

test('N inspector exposes hierarchy prefixes and duplicate code payloads without assigning semantics', () => {
  const text = [
    'N 3 4',
    row('0', 104, 'Legislativo Federal', '3999'),
    row('27', 524, 'Associação Privada', '3999'),
    row('27', 525, 'Outra', '4000'),
    '\u001Aignored',
  ].join('\r\n');
  const result = inspectNewFormatCnvText(text);
  assert.equal(result.parsedRows, 3);
  assert.equal(result.rows[0].prefix, '0');
  assert.equal(result.rows[1].prefix, '27');
  assert.deepEqual(result.duplicatePayloads, [{ payload: '3999', sequences: [104, 524] }]);
});
