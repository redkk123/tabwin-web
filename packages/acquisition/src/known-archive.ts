/**
 * Reconhece um arquivo que este aparelho já guardou.
 *
 * Quem trabalha com DATASUS acumula os mesmos `.dbc` espalhados: um baixado
 * pelo portal, outro pelo R, outro que veio de um colega. Abrir um deles sem
 * saber se é o mesmo de antes é como a análise perde rastro — dois arquivos
 * com o mesmo nome podem ser competências diferentes, e o mesmo conteúdo pode
 * chegar com três nomes.
 *
 * A comparação é por SHA-256, que o programa já calcula ao abrir qualquer
 * arquivo. Nome e tamanho não servem: o portal renomeia para `arquivo.zip`, e
 * tamanho igual não é conteúdo igual.
 */

export interface KnownArchive {
  key: string;
  sha256: string;
  savedAt: number;
  size: number;
  sources: readonly { name: string }[];
}

export interface ArchiveRecognition {
  /** O pacote guardado que tem exatamente estes bytes. */
  match: KnownArchive;
  /** Nome com que ele foi guardado, quando difere do que está sendo aberto. */
  savedAs?: string;
  ageMs: number;
}

/**
 * Procura, entre os pacotes guardados, um com o mesmo conteúdo.
 *
 * Devolve `null` quando não há — e isso não é erro nenhum: a maioria dos
 * arquivos abertos nunca passou pelo cache.
 */
export function recognizeArchive(
  sha256: string,
  cached: readonly KnownArchive[],
  openedName: string,
  now = Date.now(),
): ArchiveRecognition | null {
  if (!sha256) return null;
  // Hash vazio no cache significa entrada antiga, gravada antes de o programa
  // registrar impressão. Comparar com ela daria falso positivo em série.
  const match = cached.find((item) => item.sha256 && item.sha256 === sha256);
  if (!match) return null;

  const nomes = match.sources.map((source) => source.name).filter(Boolean);
  const mesmoNome = nomes.some((nome) => nome.toLowerCase() === openedName.toLowerCase());
  return {
    match,
    ...(mesmoNome || !nomes.length ? {} : { savedAs: nomes.join(', ') }),
    ageMs: Math.max(0, now - match.savedAt),
  };
}

/** Uma frase curta para a tela, dizendo o que foi reconhecido. */
export function describeRecognition(recognition: ArchiveRecognition): string {
  const dias = Math.floor(recognition.ageMs / 86_400_000);
  const horas = Math.floor(recognition.ageMs / 3_600_000);
  const quando = dias >= 1 ? `há ${dias} dia${dias > 1 ? 's' : ''}`
    : horas >= 1 ? `há ${horas} hora${horas > 1 ? 's' : ''}`
      : 'hoje';
  const como = recognition.savedAs ? `, guardado como ${recognition.savedAs}` : '';
  return `Este arquivo já está neste aparelho${como} — baixado ${quando}. É o mesmo conteúdo, byte a byte.`;
}
