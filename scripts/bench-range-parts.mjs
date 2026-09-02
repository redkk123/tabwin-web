#!/usr/bin/env node
/**
 * Quantas conexões paralelas o DATASUS recompensa?
 *
 * Já se sabe que ele limita **por conexão**: quatro faixas deram 3,27x sobre
 * uma. O aplicativo fixa quatro sem ter medido o joelho da curva. Este script
 * mede.
 *
 * Baixa sempre a mesma fatia de bytes, variando só o número de conexões que a
 * dividem. Fatia em vez do arquivo inteiro porque a física do limite é a mesma
 * e o custo em rede é um terço.
 *
 * As configurações são intercaladas e o resultado é o **mínimo** de cada uma,
 * não a média: a rede tem ruído só para um lado, e a média mede a
 * instabilidade do momento em vez da capacidade real.
 */

const PROXY = 'https://tabwin-web-datasus-proxy.tabwin-web.workers.dev';
const ORIGEM = 'https://tabweb.me';
const FATIA = 32 * 1024 * 1024;
const CONFIGS = [1, 2, 4, 6, 8, 12];
const RODADAS = Number(process.argv[2] ?? 3);

const postar = async (rota, corpo) => (await fetch(`${PROXY}/${rota}`, {
  method: 'POST',
  headers: { origin: ORIGEM, 'content-type': 'application/x-www-form-urlencoded' },
  body: corpo,
})).json();

async function prepararDnbr2025() {
  const busca = new URLSearchParams();
  for (const [c, v] of [['tipo_arquivo[]', 'DN'], ['modalidade[]', '1'], ['fonte[]', 'SINASC'], ['ano[]', '2025'], ['uf[]', 'BR']]) busca.append(c, v);
  const arquivo = (await postar('catalog', busca)).find((f) => f.arquivo.startsWith('DNBR2025'));
  const preparo = new URLSearchParams();
  preparo.append('dados[0][arquivo]', arquivo.arquivo);
  preparo.append('dados[0][link]', arquivo.endereco);
  const url = (await postar('prepare', preparo)).flat(9).find((v) => typeof v === 'string' && v.startsWith('http'));

  // Espera o pacote existir: medir a montagem junto falsearia tudo.
  for (let i = 0; i < 30; i++) {
    const r = await fetch(url, { headers: { range: 'bytes=0-1' } });
    await r.arrayBuffer();
    if (r.status !== 404) return url;
    await new Promise((s) => setTimeout(s, 2000));
  }
  throw new Error('o pacote preparado nunca ficou pronto');
}

async function medir(url, partes) {
  const tamanho = Math.ceil(FATIA / partes);
  const faixas = [];
  for (let inicio = 0; inicio < FATIA; inicio += tamanho) {
    faixas.push({ inicio, fim: Math.min(inicio + tamanho, FATIA) - 1 });
  }

  const alvo = `${PROXY}/archive?url=${encodeURIComponent(url)}`;
  const t0 = Date.now();
  const recebidos = await Promise.all(faixas.map(async ({ inicio, fim }) => {
    const resposta = await fetch(alvo, { headers: { origin: ORIGEM, range: `bytes=${inicio}-${fim}` } });
    if (!resposta.ok && resposta.status !== 206) throw new Error(`faixa ${inicio}-${fim}: HTTP ${resposta.status}`);
    let bytes = 0;
    const leitor = resposta.body.getReader();
    for (;;) {
      const { done, value } = await leitor.read();
      if (done) break;
      bytes += value.length;
    }
    return bytes;
  }));

  const total = recebidos.reduce((a, b) => a + b, 0);
  const segundos = (Date.now() - t0) / 1000;
  if (total !== FATIA) throw new Error(`recebi ${total} de ${FATIA} bytes`);
  return { segundos, mbps: (total / 1048576) / segundos };
}

const url = await prepararDnbr2025();
console.log(`fatia de ${(FATIA / 1048576).toFixed(0)} MB, ${RODADAS} rodadas intercaladas\n`);

const resultados = new Map(CONFIGS.map((p) => [p, []]));
for (let rodada = 1; rodada <= RODADAS; rodada++) {
  for (const partes of CONFIGS) {
    try {
      const { segundos, mbps } = await medir(url, partes);
      resultados.get(partes).push({ segundos, mbps });
      console.log(`  rodada ${rodada} · ${String(partes).padStart(2)} conexões: ${segundos.toFixed(2)}s (${mbps.toFixed(2)} MB/s)`);
    } catch (erro) {
      console.log(`  rodada ${rodada} · ${String(partes).padStart(2)} conexões: falhou — ${erro.message}`);
    }
  }
}

console.log('\nmelhor de cada configuração:');
let base = null;
for (const partes of CONFIGS) {
  const amostras = resultados.get(partes);
  if (!amostras.length) { console.log(`  ${String(partes).padStart(2)}: sem amostra`); continue; }
  const melhor = amostras.reduce((a, b) => (a.segundos <= b.segundos ? a : b));
  base ??= melhor.segundos;
  console.log(`  ${String(partes).padStart(2)} conexões: ${melhor.segundos.toFixed(2)}s`
    + ` · ${melhor.mbps.toFixed(2)} MB/s · ${(base / melhor.segundos).toFixed(2)}x sobre uma conexão`);
}
