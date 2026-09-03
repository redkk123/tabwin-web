/**
 * Retomada de download, do lado das decisões.
 *
 * O problema: no 4G, um arquivo de 112 MB leva minutos, e uma queda joga fora
 * tudo o que já tinha chegado. Quem está no ônibus recomeça do zero, de novo,
 * até desistir.
 *
 * A retomada é perigosa quando não se sabe se o arquivo do servidor ainda é o
 * mesmo: colar um pedaço velho num pedaço novo produz um arquivo corrompido
 * que *parece* íntegro. É por isso que este módulo só funciona com o **hash
 * esperado em mãos**, que é o caso do espelho — o manifesto traz o SHA-256
 * antes de o download começar.
 *
 * Esse hash é a chave da parte guardada, e isso resolve a validade sozinho: um
 * pedaço do arquivo de hash X só serve para o arquivo de hash X. Se o DATASUS
 * republicar o arquivo, o hash no manifesto muda, e a parte antiga
 * simplesmente nunca é encontrada. Não há parte velha para expirar, nem
 * carimbo de tempo para conferir.
 *
 * A conferência final continua existindo: mesmo retomando, os bytes montados
 * passam pelo SHA-256. A retomada economiza rede, nunca dispensa a prova.
 */

/** Uma parte guardada, como o armazenamento a descreve. */
export interface PartialDownload {
  /** SHA-256 esperado do arquivo inteiro, em minúsculas. */
  sha256: string;
  /** Bytes já guardados, sempre a partir do começo do arquivo. */
  bytes: number;
  /** Tamanho total declarado no manifesto. */
  totalBytes: number;
}

export interface ResumeDecision {
  /** Onde continuar. Zero quer dizer começar do princípio. */
  from: number;
  /** Cabeçalho `Range` a mandar, ou `undefined` para pedir o arquivo todo. */
  rangeHeader?: string;
  /** Por que esta decisão, em português, para o registro e para a tela. */
  reason: string;
}

/**
 * Quanto pode ser aproveitado de uma parte guardada.
 *
 * Recusa em silêncio é o que não pode acontecer aqui — cada recusa diz por
 * quê, porque uma retomada que "não pegou" sem explicação é indistinguível de
 * um bug.
 */
export function decideResume(
  partial: PartialDownload | null,
  expected: { sha256: string; totalBytes: number },
): ResumeDecision {
  if (!partial) return { from: 0, reason: 'não havia parte guardada' };

  if (partial.sha256.toLowerCase() !== expected.sha256.toLowerCase()) {
    // Não deveria acontecer, porque o hash é a chave da busca. Se acontecer, é
    // sinal de armazenamento inconsistente, e confiar seria colar arquivos
    // diferentes.
    return { from: 0, reason: 'a parte guardada é de outro arquivo' };
  }
  if (partial.totalBytes !== expected.totalBytes) {
    return { from: 0, reason: 'o tamanho declarado mudou desde que a parte foi guardada' };
  }
  if (!Number.isSafeInteger(partial.bytes) || partial.bytes < 0) {
    return { from: 0, reason: 'a parte guardada tem tamanho inválido' };
  }
  if (partial.bytes === 0) return { from: 0, reason: 'a parte guardada estava vazia' };
  if (partial.bytes >= expected.totalBytes) {
    // Uma parte do tamanho do arquivo inteiro não foi conferida, senão teria
    // sido entregue e apagada. Tratar como suspeita e refazer é mais barato do
    // que entregar bytes que ninguém validou.
    return { from: 0, reason: 'a parte guardada está completa mas não conferida; refazendo' };
  }

  return {
    from: partial.bytes,
    rangeHeader: `bytes=${partial.bytes}-`,
    reason: `retomando de ${partial.bytes} de ${expected.totalBytes} bytes`,
  };
}

/**
 * Se a resposta do servidor honrou a retomada.
 *
 * Um servidor pode ignorar o `Range` e mandar o arquivo inteiro com 200. Somar
 * isso ao que já havia daria o dobro do arquivo; por isso a resposta decide
 * quanto do guardado sobrevive, e não o pedido.
 */
export function acceptResume(
  status: number,
  contentRange: string | null,
  decision: ResumeDecision,
): { keepBytes: number; reason: string } {
  if (decision.from === 0) return { keepBytes: 0, reason: 'começando do princípio' };

  if (status === 200) {
    // O servidor mandou tudo. Não é erro — é só a retomada não valendo.
    return { keepBytes: 0, reason: 'a origem ignorou a faixa e mandou o arquivo inteiro' };
  }
  if (status !== 206) {
    return { keepBytes: 0, reason: `a origem respondeu ${status} em vez de 206` };
  }

  // `Content-Range: bytes <início>-<fim>/<total>`. O início precisa ser
  // exatamente onde paramos; qualquer outro valor montaria o arquivo torto.
  const achou = /^bytes\s+(\d+)-(\d+)\/(\d+)$/i.exec((contentRange ?? '').trim());
  if (!achou) return { keepBytes: 0, reason: 'a origem não disse qual faixa mandou' };

  const inicio = Number(achou[1]);
  if (inicio !== decision.from) {
    return { keepBytes: 0, reason: `a origem começou em ${inicio}, e não em ${decision.from}` };
  }
  return { keepBytes: decision.from, reason: 'retomada aceita' };
}

/**
 * De quanto em quanto gravar o que chegou.
 *
 * Gravar cada pedaço no disco custaria mais tempo do que a rede economiza; não
 * gravar até o fim não protege ninguém. Oito megabytes é o meio-termo: numa
 * conexão de celular representa dezenas de segundos de download preservados, e
 * numa boa é raro o suficiente para não pesar.
 */
export const FLUSH_INTERVAL_BYTES = 8 * 1024 * 1024;

export function shouldFlush(bytesSinceFlush: number): boolean {
  return bytesSinceFlush >= FLUSH_INTERVAL_BYTES;
}

/**
 * O armazenamento das partes, visto por quem baixa.
 *
 * A interface existe para o download não depender de OPFS: em teste entra uma
 * implementação em memória, e a lógica de retomada — que é a parte delicada —
 * fica exercitável sem navegador.
 */
export interface PartialStore {
  read(sha256: string, totalBytes: number): Promise<PartialDownload | null>;
  readBytes(sha256: string, expectedBytes: number): Promise<Uint8Array | null>;
  write(sha256: string, bytes: Uint8Array): Promise<void>;
  delete(sha256: string): Promise<void>;
}

/**
 * Um armazenamento que não guarda nada.
 *
 * É o padrão quando o navegador não tem OPFS. Assim o caminho sem retomada é o
 * mesmo código do caminho com retomada, em vez de um desvio à parte que
 * ninguém testa.
 */
export const NO_PARTIAL_STORE: PartialStore = Object.freeze({
  read: async () => null,
  readBytes: async () => null,
  write: async () => {},
  delete: async () => {},
});
