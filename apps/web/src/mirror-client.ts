/**
 * Busca um pacote no espelho, quando ele existir e conferir.
 *
 * O espelho é atalho, nunca fonte de verdade. Três regras que decorrem disso:
 *
 * 1. **Nunca impede o download.** Qualquer dúvida — manifesto ausente, arquivo
 *    fora do espelho, hash diferente, rede ruim — devolve `null`, e o chamador
 *    segue pelo DATASUS sem saber que tentou.
 * 2. **Sempre verifica.** O SHA-256 do que chegou é comparado com o declarado
 *    no manifesto versionado. Espelho sem verificação seria apenas uma origem
 *    não oficial, que é pior do que não ter espelho.
 * 3. **O manifesto vem do site, não do bucket.** Ele é publicado junto do
 *    aplicativo, com histórico no git. Se viesse do bucket, quem controla o
 *    bucket controlaria o arquivo e o hash esperado ao mesmo tempo.
 */

import {
  lookupInMirror,
  parseMirrorManifest,
  type MirrorManifestV1,
} from '../../../packages/acquisition/src/mirror-manifest.ts';
import {
  acceptResume,
  decideResume,
  shouldFlush,
  type PartialStore,
} from '../../../packages/acquisition/src/partial-download.ts';
import { OPFS_PARTIAL_STORE } from './opfs-partials.ts';

const MANIFEST_URL = './mirror.json';

let manifestoCarregado: Promise<MirrorManifestV1 | null> | undefined;

/** Lê o manifesto uma vez por sessão. Ausência é o caso normal, não erro. */
function carregarManifesto(): Promise<MirrorManifestV1 | null> {
  manifestoCarregado ??= (async () => {
    try {
      const resposta = await fetch(MANIFEST_URL, { cache: 'no-cache' });
      if (!resposta.ok) return null;
      return parseMirrorManifest(await resposta.text());
    } catch {
      // Sem espelho publicado, ou resposta que não é manifesto. O aplicativo
      // funciona igual — é só o atalho que não existe.
      return null;
    }
  })();
  return manifestoCarregado;
}

export interface MirrorFetchResult {
  bytes: Uint8Array;
  /** Para a auditoria registrar de onde o arquivo veio de fato. */
  url: string;
}

/**
 * Tenta o espelho. Devolve `null` sempre que o DATASUS deva ser usado.
 *
 * `computeSha256` é injetado porque a implementação vive na thread principal e
 * este módulo precisa ser testável em Node.
 */
export async function fetchFromMirror(
  fileName: string,
  computeSha256: (bytes: Uint8Array) => Promise<string>,
  options: {
    fetchImpl?: typeof fetch;
    signal?: AbortSignal;
    onProgress?: (received: number, total: number) => void;
    /** Avisa que um download anterior está sendo retomado, e de onde. */
    onResume?: (fromBytes: number, totalBytes: number, reason: string) => void;
    /** Onde as partes ficam. O padrão é o OPFS; o teste injeta o seu. */
    partials?: PartialStore;
  } = {},
): Promise<MirrorFetchResult | null> {
  const manifesto = await carregarManifesto();
  if (!manifesto) return null;

  const alvo = lookupInMirror(manifesto, fileName);
  if (!alvo) return null;

  const buscar = options.fetchImpl ?? fetch;
  const partes = options.partials ?? OPFS_PARTIAL_STORE;
  try {
    // Retoma o que ficou de uma tentativa anterior. Só o espelho permite isso
    // com segurança: o hash esperado vem no manifesto ANTES do download, então
    // uma parte guardada é inequivocamente deste arquivo. Ver
    // `partial-download.ts` para o raciocínio inteiro.
    const guardada = await partes.read(alvo.sha256, alvo.bytes);
    const decisao = decideResume(guardada, { sha256: alvo.sha256, totalBytes: alvo.bytes });
    if (decisao.from > 0) options.onResume?.(decisao.from, alvo.bytes, decisao.reason);

    const resposta = await buscar(alvo.url, {
      ...(options.signal ? { signal: options.signal } : {}),
      ...(decisao.rangeHeader ? { headers: { Range: decisao.rangeHeader } } : {}),
    });
    if (!resposta.ok || !resposta.body) return null;

    // Quem decide o que sobrevive é a RESPOSTA, não o pedido: uma origem que
    // ignora a faixa e manda tudo com 200 faria a soma dar o dobro do arquivo.
    // O cabeçalho só é lido quando há retomada em jogo: no caminho comum não
    // há o que decidir, e `acceptResume` já devolveria zero de qualquer forma.
    const aceite = decisao.from > 0
      ? acceptResume(resposta.status, resposta.headers?.get('content-range') ?? null, decisao)
      : { keepBytes: 0, reason: 'começando do princípio' };
    const anteriores = aceite.keepBytes > 0
      ? await partes.readBytes(alvo.sha256, aceite.keepBytes)
      : null;

    const pedacos: Uint8Array[] = [];
    let recebidos = 0;
    if (anteriores) {
      pedacos.push(anteriores);
      recebidos = anteriores.byteLength;
    }

    let desdeGravacao = 0;
    const leitor = resposta.body.getReader();
    for (;;) {
      const { done, value } = await leitor.read();
      if (done) break;
      pedacos.push(value);
      recebidos += value.byteLength;
      desdeGravacao += value.byteLength;
      options.onProgress?.(recebidos, alvo.bytes);
      // Grava de tempos em tempos, para uma queda não custar tudo de novo. A
      // gravação é o arquivo inteiro até aqui, e não um acréscimo: um
      // acréscimo interrompido no meio deixaria em disco mais bytes do que os
      // válidos, e a retomada seguinte continuaria do lugar errado.
      if (shouldFlush(desdeGravacao)) {
        desdeGravacao = 0;
        await partes.write(alvo.sha256, juntar(pedacos, recebidos));
      }
    }

    const bytes = juntar(pedacos, recebidos);

    // A verificação é o que separa um espelho de uma origem qualquer. Hash
    // diferente do declarado no manifesto versionado: descarta e vai ao
    // DATASUS, sem alarde — o objetivo é o dado certo, não acusar ninguém.
    if (await computeSha256(bytes) !== alvo.sha256) {
      // Retomada ou não, o hash é a prova. Se não bate, a parte guardada é
      // suspeita: apaga, para a próxima tentativa não repetir o mesmo erro.
      await partes.delete(alvo.sha256);
      return null;
    }
    await partes.delete(alvo.sha256);
    return { bytes, url: alvo.url };
  } catch {
    // O que já chegou fica no disco de propósito: é justamente a queda no meio
    // que a retomada existe para socorrer.
    return null;
  }
}

/** Junta os pedaços num buffer só, sem cópia intermediária. */
function juntar(pedacos: readonly Uint8Array[], total: number): Uint8Array {
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const pedaco of pedacos) {
    bytes.set(pedaco, offset);
    offset += pedaco.byteLength;
  }
  return bytes;
}

/** Esquece o manifesto lido, para o teste não herdar estado entre casos. */
export function resetMirrorCache(): void {
  manifestoCarregado = undefined;
}
