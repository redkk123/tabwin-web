import assert from 'node:assert/strict';
import test from 'node:test';

import { watchPublishedVersion } from '../dist/packages/core/src/version-watch.js';

/** Um fetch falso que devolve os builds na ordem, repetindo o último. */
function servidor(builds) {
  let indice = 0;
  const pedidos = [];
  return {
    pedidos,
    fetchImpl: async (url, init) => {
      pedidos.push({ url, cache: init?.cache });
      const build = builds[Math.min(indice++, builds.length - 1)];
      if (build === null) return { ok: false, status: 404, json: async () => ({}) };
      return { ok: true, status: 200, json: async () => ({ build }) };
    },
  };
}

const proximoTique = () => new Promise((r) => setImmediate(r));

test('não avisa nada enquanto a versão publicada é a mesma', async () => {
  const { fetchImpl } = servidor(['abc123']);
  let avisos = 0;
  let verificar = () => {};
  watchPublishedVersion({ fetchImpl, onNewVersion: () => avisos++, subscribe: (c) => { verificar = c; } });
  await proximoTique();
  verificar();
  await proximoTique();
  assert.equal(avisos, 0);
});

test('avisa uma vez quando o site publicado muda', async () => {
  const { fetchImpl } = servidor(['abc123', 'def456', 'def456']);
  let avisos = 0;
  let verificar = () => {};
  watchPublishedVersion({ fetchImpl, onNewVersion: () => avisos++, subscribe: (c) => { verificar = c; } });
  await proximoTique();

  verificar();
  await proximoTique();
  assert.equal(avisos, 1, 'a mudança precisa produzir exatamente um aviso');

  // Insistir não pode multiplicar o aviso: quem já foi avisado não ganha nada
  // com um segundo aviso, e um banner que reaparece vira ruído.
  verificar();
  await proximoTique();
  assert.equal(avisos, 1);
});

test('a primeira leitura só registra, nunca avisa', async () => {
  // Sem esta regra, toda aba recém-aberta acusaria versão nova, porque não
  // teria com o que comparar.
  const { fetchImpl } = servidor(['abc123']);
  let avisos = 0;
  watchPublishedVersion({ fetchImpl, onNewVersion: () => avisos++, subscribe: () => {} });
  await proximoTique();
  assert.equal(avisos, 0);
});

test('pede sem cache, senão compararia a resposta antiga consigo mesma', async () => {
  const { fetchImpl, pedidos } = servidor(['abc123']);
  watchPublishedVersion({ fetchImpl, onNewVersion: () => {}, subscribe: () => {} });
  await proximoTique();
  assert.equal(pedidos[0].cache, 'no-store');
});

test('site sem version.json não atrapalha o uso', async () => {
  const { fetchImpl } = servidor([null]);
  let avisos = 0;
  let verificar = () => {};
  watchPublishedVersion({ fetchImpl, onNewVersion: () => avisos++, subscribe: (c) => { verificar = c; } });
  await proximoTique();
  verificar();
  await proximoTique();
  assert.equal(avisos, 0);
});

test('erro de rede na checagem não derruba nada', async () => {
  let avisos = 0;
  watchPublishedVersion({
    fetchImpl: async () => { throw new TypeError('failed to fetch'); },
    onNewVersion: () => avisos++,
    subscribe: () => {},
  });
  await proximoTique();
  assert.equal(avisos, 0);
});
