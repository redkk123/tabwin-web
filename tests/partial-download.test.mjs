import assert from 'node:assert/strict';
import test from 'node:test';
import {
  FLUSH_INTERVAL_BYTES,
  acceptResume,
  decideResume,
  shouldFlush,
} from '../dist/packages/acquisition/src/partial-download.js';

const ESPERADO = { sha256: 'abc123', totalBytes: 1000 };
const parte = (extra = {}) => ({ sha256: 'abc123', bytes: 400, totalBytes: 1000, ...extra });

test('sem parte guardada, começa do princípio', () => {
  const d = decideResume(null, ESPERADO);
  assert.equal(d.from, 0);
  assert.equal(d.rangeHeader, undefined);
});

test('uma parte válida vira uma faixa que continua de onde parou', () => {
  const d = decideResume(parte(), ESPERADO);
  assert.equal(d.from, 400);
  assert.equal(d.rangeHeader, 'bytes=400-');
});

test('o hash é comparado sem depender de maiúsculas', () => {
  const d = decideResume(parte({ sha256: 'ABC123' }), ESPERADO);
  assert.equal(d.from, 400, 'recusou uma parte que era do mesmo arquivo');
});

test('parte de outro arquivo é descartada, e diz por quê', () => {
  // Colar bytes de arquivos diferentes produz algo que parece íntegro e não é.
  const d = decideResume(parte({ sha256: 'outro' }), ESPERADO);
  assert.equal(d.from, 0);
  assert.match(d.reason, /outro arquivo/);
});

test('tamanho total diferente descarta a parte', () => {
  const d = decideResume(parte({ totalBytes: 999 }), ESPERADO);
  assert.equal(d.from, 0);
  assert.match(d.reason, /tamanho declarado mudou/);
});

test('parte do tamanho do arquivo inteiro é refeita, não entregue', () => {
  // Se estivesse completa E conferida, teria sido entregue e apagada. Estar
  // aqui significa que ninguém validou aqueles bytes.
  for (const bytes of [1000, 1200]) {
    const d = decideResume(parte({ bytes }), ESPERADO);
    assert.equal(d.from, 0, `aceitou ${bytes}`);
    assert.match(d.reason, /não conferida/);
  }
});

test('tamanho inválido não vira faixa', () => {
  for (const bytes of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.equal(decideResume(parte({ bytes }), ESPERADO).from, 0, `aceitou ${bytes}`);
  }
});

test('toda decisão explica a si mesma', () => {
  // Uma retomada que "não pegou" sem motivo é indistinguível de um bug.
  for (const p of [null, parte(), parte({ sha256: 'x' }), parte({ bytes: 0 })]) {
    assert.ok(decideResume(p, ESPERADO).reason.length > 5);
  }
});

test('a origem que ignora a faixa e manda tudo não corrompe o resultado', () => {
  // Somar 200 ao que já havia daria o dobro do arquivo.
  const d = decideResume(parte(), ESPERADO);
  const a = acceptResume(200, null, d);
  assert.equal(a.keepBytes, 0);
  assert.match(a.reason, /arquivo inteiro/);
});

test('206 com a faixa certa aproveita o que já estava guardado', () => {
  const d = decideResume(parte(), ESPERADO);
  const a = acceptResume(206, 'bytes 400-999/1000', d);
  assert.equal(a.keepBytes, 400);
});

test('206 que começa em outro ponto é recusado', () => {
  // Montar isso deixaria um buraco ou uma sobreposição no meio do arquivo.
  const d = decideResume(parte(), ESPERADO);
  for (const cr of ['bytes 0-999/1000', 'bytes 500-999/1000', 'bytes 399-999/1000']) {
    const a = acceptResume(206, cr, d);
    assert.equal(a.keepBytes, 0, `aceitou ${cr}`);
  }
});

test('206 sem Content-Range legível é recusado', () => {
  const d = decideResume(parte(), ESPERADO);
  for (const cr of [null, '', 'bytes */1000', 'lixo']) {
    assert.equal(acceptResume(206, cr, d).keepBytes, 0, `aceitou ${JSON.stringify(cr)}`);
  }
});

test('qualquer status fora de 200 e 206 recomeça', () => {
  const d = decideResume(parte(), ESPERADO);
  for (const status of [204, 301, 404, 416, 500]) {
    assert.equal(acceptResume(status, 'bytes 400-999/1000', d).keepBytes, 0, `aceitou ${status}`);
  }
});

test('quando não havia o que retomar, nada é aproveitado', () => {
  const d = decideResume(null, ESPERADO);
  assert.equal(acceptResume(206, 'bytes 0-999/1000', d).keepBytes, 0);
});

test('a gravação acontece a cada oito megabytes, não a cada pedaço', () => {
  // Gravar cada pedaço custaria mais do que a rede economiza.
  assert.equal(shouldFlush(FLUSH_INTERVAL_BYTES - 1), false);
  assert.equal(shouldFlush(FLUSH_INTERVAL_BYTES), true);
  assert.equal(shouldFlush(0), false);
});
