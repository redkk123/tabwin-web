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
  } = {},
): Promise<MirrorFetchResult | null> {
  const manifesto = await carregarManifesto();
  if (!manifesto) return null;

  const alvo = lookupInMirror(manifesto, fileName);
  if (!alvo) return null;

  const buscar = options.fetchImpl ?? fetch;
  try {
    const resposta = await buscar(alvo.url, {
      ...(options.signal ? { signal: options.signal } : {}),
    });
    if (!resposta.ok || !resposta.body) return null;

    const pedacos: Uint8Array[] = [];
    let recebidos = 0;
    const leitor = resposta.body.getReader();
    for (;;) {
      const { done, value } = await leitor.read();
      if (done) break;
      pedacos.push(value);
      recebidos += value.byteLength;
      options.onProgress?.(recebidos, alvo.bytes);
    }

    const bytes = new Uint8Array(recebidos);
    let offset = 0;
    for (const pedaco of pedacos) {
      bytes.set(pedaco, offset);
      offset += pedaco.byteLength;
    }

    // A verificação é o que separa um espelho de uma origem qualquer. Hash
    // diferente do declarado no manifesto versionado: descarta e vai ao
    // DATASUS, sem alarde — o objetivo é o dado certo, não acusar ninguém.
    if (await computeSha256(bytes) !== alvo.sha256) return null;
    return { bytes, url: alvo.url };
  } catch {
    return null;
  }
}

/** Esquece o manifesto lido, para o teste não herdar estado entre casos. */
export function resetMirrorCache(): void {
  manifestoCarregado = undefined;
}
