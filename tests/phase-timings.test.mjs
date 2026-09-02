import assert from 'node:assert/strict';
import test from 'node:test';

import { createPhaseTimings, describePhaseTimings } from '../dist/packages/core/src/phase-timings.js';

/** Relógio falso: o teste mede a contabilidade, não o tempo de parede. */
function relogio() {
  let agora = 0;
  return { now: () => agora, avancar: (ms) => { agora += ms; } };
}

test('credita a cada fase o tempo que ela gastou', async () => {
  const t = relogio();
  const tempos = createPhaseTimings(t.now);

  await tempos.measure('download', async () => { t.avancar(2000); });
  await tempos.measure('descompressão', async () => { t.avancar(500); });

  assert.deepEqual(tempos.samples(), [
    { phase: 'download', totalMs: 2000, count: 1 },
    { phase: 'descompressão', totalMs: 500, count: 1 },
  ]);
});

test('soma as repetições da mesma fase, como num lote de arquivos', async () => {
  const t = relogio();
  const tempos = createPhaseTimings(t.now);
  for (const ms of [1000, 2000, 3000]) {
    await tempos.measure('download', async () => { t.avancar(ms); });
  }
  assert.deepEqual(tempos.samples(), [{ phase: 'download', totalMs: 6000, count: 3 }]);
});

test('uma fase que falhou ainda conta o tempo que consumiu', async () => {
  // Sem isto o relatório de uma falha não fecharia a conta, e o tempo perdido
  // na tentativa — que é justamente o que se quer entender — sumiria.
  const t = relogio();
  const tempos = createPhaseTimings(t.now);
  await assert.rejects(tempos.measure('download', async () => {
    t.avancar(1500);
    throw new Error('caiu');
  }), /caiu/);
  assert.deepEqual(tempos.samples(), [{ phase: 'download', totalMs: 1500, count: 1 }]);
});

test('a ordem é a cronológica, não a alfabética', async () => {
  const t = relogio();
  const tempos = createPhaseTimings(t.now);
  await tempos.measure('zzz', async () => { t.avancar(10); });
  await tempos.measure('aaa', async () => { t.avancar(10); });
  assert.deepEqual(tempos.samples().map((s) => s.phase), ['zzz', 'aaa']);
});

test('valores impossíveis não entram na conta', () => {
  const tempos = createPhaseTimings(() => 0);
  tempos.add('x', Number.NaN);
  tempos.add('x', -5);
  tempos.add('x', Number.POSITIVE_INFINITY);
  assert.deepEqual(tempos.samples(), []);
});

test('a descrição mostra a fatia de cada fase sobre o total', () => {
  // Porcentagens redondas de propósito: numa fatia de exatamente 57,5% o
  // resultado depende de ponto flutuante (0,575 × 100 dá 57,49999…), e o que
  // este teste verifica é o formato, não a regra de arredondamento.
  const linhas = describePhaseTimings([
    { phase: 'preparo', totalMs: 12000, count: 1 },
    { phase: 'download', totalMs: 24000, count: 1 },
    { phase: 'leitura', totalMs: 4000, count: 2 },
  ]);
  assert.deepEqual(linhas, [
    'preparo: 12.00s (30%)',
    'download: 24.00s (60%)',
    'leitura: 4.00s (10% · 2x)',
  ]);
});

test('sem tempo medido não há descrição para dar', () => {
  assert.deepEqual(describePhaseTimings([]), []);
  assert.deepEqual(describePhaseTimings([{ phase: 'x', totalMs: 0, count: 1 }]), []);
});
