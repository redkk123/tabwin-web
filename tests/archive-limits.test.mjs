import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ARCHIVE_LIMITS,
  classifyArchiveEntry,
  createArchiveBudget,
  describeSkippedEntries,
} from '../dist/packages/acquisition/src/archive-limits.js';

const wantEverything = () => true;
const MB = 1024 * 1024;

test('an ordinary entry is taken and counted against the total', () => {
  const budget = createArchiveBudget();
  assert.deepEqual(classifyArchiveEntry({ name: 'A.DEF', originalSize: 20_000 }, budget, wantEverything), { action: 'take' });
  assert.equal(budget.expandedBytes, 20_000);
  assert.equal(budget.skipped.length, 0);
});

test('the real UNIDTOTAL.DBF now fits - it was refused by three megabytes', () => {
  // Measured from a real run against the official TAB_SINANNET package: 259 MB,
  // rejected by a 256 MB per-file cap. The cap now sits at the overall budget,
  // so a file that fits in the tab is admissible.
  const budget = createArchiveBudget();
  const measured = 259 * 1024 * 1024;
  assert.equal(classifyArchiveEntry({ name: 'TAB_SINANNET/UNIDTOTAL.DBF', originalSize: measured }, budget, wantEverything).action, 'take');
  assert.equal(budget.skipped.length, 0);
});

test('one oversized member is skipped, and the rest of the bundle still comes through', () => {
  // The case that exposed this: TAB_SINANNET carries the DEF and CNV files
  // that make a SINAN tabulation legible plus UNIDTOTAL.DBF, a very large
  // lookup table. Throwing on the lookup used to cost the user every DEF and
  // CNV in the package - the whole reason to open it.
  const budget = createArchiveBudget();
  const bundle = [
    { name: 'TAB_SINANNET/ACIDBIO.DEF', originalSize: 18_000 },
    { name: 'TAB_SINANNET/UNIDTOTAL.DBF', originalSize: ARCHIVE_LIMITS.maxFileBytes + 1 },
    { name: 'TAB_SINANNET/CID10.CNV', originalSize: 42_000 },
  ];
  const decisions = bundle.map((entry) => classifyArchiveEntry(entry, budget, wantEverything).action);

  assert.deepEqual(decisions, ['take', 'skip', 'take']);
  assert.deepEqual(budget.skipped, [
    { name: 'TAB_SINANNET/UNIDTOTAL.DBF', bytes: ARCHIVE_LIMITS.maxFileBytes + 1, reason: 'too-large' },
  ]);
  // The skipped entry is never expanded, so it must not count against the
  // total either - otherwise refusing to read it would still spend its budget.
  assert.equal(budget.expandedBytes, 60_000);
});

test('an entry exactly at the per-file limit is taken - the limit is a maximum, not a fence', () => {
  const budget = createArchiveBudget();
  assert.equal(classifyArchiveEntry({ name: 'BIG.DBF', originalSize: ARCHIVE_LIMITS.maxFileBytes }, budget, wantEverything).action, 'take');
  assert.equal(budget.skipped.length, 0);
});

test('unwanted extensions are ignored without touching the budget', () => {
  const budget = createArchiveBudget();
  const isWanted = (name) => name.endsWith('.DEF');
  assert.equal(classifyArchiveEntry({ name: 'LEIAME.TXT', originalSize: 5_000 }, budget, isWanted).action, 'ignore');
  assert.equal(budget.expandedBytes, 0);
  // Still counted as seen: an archive stuffed with millions of ignorable
  // entries is as hostile as one stuffed with readable ones.
  assert.equal(budget.entriesSeen, 1);
});

test('aggregate breaches stay fatal, because they describe the archive itself', () => {
  const total = createArchiveBudget();
  assert.throws(() => {
    for (let index = 0; index < 20; index++) {
      classifyArchiveEntry({ name: `F${index}.DBF`, originalSize: 40 * MB }, total, wantEverything);
    }
  }, /limite total expandido/);

  const many = createArchiveBudget();
  assert.throws(() => {
    for (let index = 0; index <= ARCHIVE_LIMITS.maxEntries; index++) {
      classifyArchiveEntry({ name: `F${index}.DEF`, originalSize: 10 }, many, wantEverything);
    }
  }, /arquivos demais/);
});

test('a zip bomb of oversized members is still refused, by the total it never gets to spend', () => {
  // Skipping is not a way in: each skipped member is refused on its own, and
  // nothing it declares is ever expanded.
  const budget = createArchiveBudget();
  for (let index = 0; index < 500; index++) {
    const decision = classifyArchiveEntry({ name: `BOMB${index}.DBF`, originalSize: 4 * 1024 * MB }, budget, wantEverything);
    assert.equal(decision.action, 'skip');
  }
  assert.equal(budget.expandedBytes, 0);
  assert.equal(budget.skipped.length, 500);
});

test('the notice names the file and its size, so the omission is legible', () => {
  const message = describeSkippedEntries([
    { name: 'TAB_SINANNET/UNIDTOTAL.DBF', bytes: 600 * MB, reason: 'too-large' },
  ]);
  assert.match(message, /UNIDTOTAL\.DBF/);
  assert.match(message, /600 MB/);
  // Derived from the limit itself: a hardcoded number here silently went stale
  // the moment the cap moved, which is how this assertion first broke.
  const statedLimit = `${Math.round(ARCHIVE_LIMITS.maxFileBytes / MB)} MB`;
  assert.ok(message.includes(statedLimit), `the limit itself must be stated, not just the breach: ${statedLimit}`);
  assert.match(message, /restante do pacote foi aberto/);
  assert.match(message, /pelo código em vez do nome/, 'the user should know what the consequence looks like');
});

test('nothing skipped means nothing to report, not an empty notice', () => {
  assert.equal(describeSkippedEntries([]), null);
});

test('several skipped files are counted and all named', () => {
  const message = describeSkippedEntries([
    { name: 'A.DBF', bytes: 600 * MB, reason: 'too-large' },
    { name: 'B.DBF', bytes: 2 * 1024 * MB, reason: 'too-large' },
  ]);
  assert.match(message, /2 arquivos/);
  assert.match(message, /A\.DBF/);
  assert.match(message, /B\.DBF/);
  assert.match(message, /2\.0 GB/, 'sizes past a gigabyte should read as gigabytes');
});
