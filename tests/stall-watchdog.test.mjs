import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DEFAULT_STALL_MS,
  createStallWatchdog,
} from '../dist/packages/acquisition/src/stall-watchdog.js';

/** Relógio de mentira: dispara quando eu mandar, não quando o tempo passar. */
function relogio() {
  let proximo = 1;
  const pendentes = new Map();
  return {
    setTimer(fn, ms) { const id = proximo++; pendentes.set(id, { fn, ms }); return id; },
    clearTimer(id) { pendentes.delete(id); },
    /** Dispara tudo que está armado. */
    avancar() { for (const [id, { fn }] of [...pendentes]) { pendentes.delete(id); fn(); } },
    get armados() { return pendentes.size; },
    get prazos() { return [...pendentes.values()].map((p) => p.ms); },
  };
}

test('quem continua recebendo bytes não é cortado, por mais que demore', () => {
  // O defeito que isto tranca: um `setTimeout` de 120 s sobre o fluxo inteiro.
  // A 0,8 MB/s isso dava um teto de ~96 MB, e um arquivo nacional de 121 MB
  // precisava de ~152 s só para chegar — morria sempre, e a mensagem culpava
  // o DATASUS por um limite nosso.
  const t = relogio();
  let cortes = 0;
  const vigia = createStallWatchdog({
    idleMs: 90_000, onStall: () => { cortes++; },
    setTimer: t.setTimer, clearTimer: t.clearTimer,
  });

  // Vinte blocos de bytes chegando: muito mais tempo total que qualquer prazo
  // de parede, mas sem nenhum silêncio.
  for (let i = 0; i < 20; i++) {
    vigia.nudge();
    assert.equal(t.armados, 1, 'o vigia fica armado, e só um de cada vez');
  }
  assert.equal(cortes, 0, 'progresso contínuo não pode ser cortado');
  assert.equal(vigia.stalled, false);
  vigia.dispose();
  assert.equal(t.armados, 0, 'encerrar desarma');
});

test('quem para de responder é cortado', () => {
  const t = relogio();
  let cortes = 0;
  const vigia = createStallWatchdog({
    idleMs: 90_000, onStall: () => { cortes++; },
    setTimer: t.setTimer, clearTimer: t.clearTimer,
  });
  vigia.nudge();
  t.avancar();
  assert.equal(cortes, 1, 'silêncio além do limite é parada');
  assert.equal(vigia.stalled, true, 'a interface precisa poder dizer que foi parada, não cancelamento');
});

test('sinal de vida atrasado não ressuscita o que já foi cancelado', () => {
  // Depois de disparar, o abort já foi para quem esperava. Rearmar aqui
  // deixaria um vigia vivo cuidando de um trabalho morto.
  const t = relogio();
  let cortes = 0;
  const vigia = createStallWatchdog({
    idleMs: 1000, onStall: () => { cortes++; },
    setTimer: t.setTimer, clearTimer: t.clearTimer,
  });
  t.avancar();
  assert.equal(cortes, 1);
  vigia.nudge();
  assert.equal(t.armados, 0, 'não pode rearmar depois de disparar');
  t.avancar();
  assert.equal(cortes, 1, 'e não pode disparar de novo');
});

test('encerrar antes do disparo impede o corte de um trabalho que terminou', () => {
  const t = relogio();
  let cortes = 0;
  const vigia = createStallWatchdog({
    idleMs: 1000, onStall: () => { cortes++; },
    setTimer: t.setTimer, clearTimer: t.clearTimer,
  });
  vigia.dispose();
  t.avancar();
  assert.equal(cortes, 0);
  vigia.dispose();
  assert.equal(cortes, 0, 'encerrar duas vezes não pode explodir');
});

test('o limite é declarado e validado', () => {
  const t = relogio();
  const vigia = createStallWatchdog({
    idleMs: 45_000, onStall: () => {}, setTimer: t.setTimer, clearTimer: t.clearTimer,
  });
  assert.equal(vigia.idleMs, 45_000, 'a mensagem precisa poder citar o número certo');
  assert.deepEqual(t.prazos, [45_000]);
  vigia.dispose();

  assert.equal(DEFAULT_STALL_MS, 90_000);
  for (const invalido of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.throws(() => createStallWatchdog({ idleMs: invalido, onStall: () => {} }), /limite positivo/);
  }
});
