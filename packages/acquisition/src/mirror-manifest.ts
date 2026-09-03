/**
 * Espelho opcional dos pacotes do DATASUS, com procedência verificável.
 *
 * O ganho não é banda: o download já vai a 14 MB/s pelo proxy. É matar os ~11
 * segundos que o portal leva montando o zip a cada pedido — o único custo fixo
 * que sobrou no caminho, e o que mais pesa quando se abre um arquivo só.
 *
 * A regra que sustenta a confiança: **o manifesto mora no repositório público,
 * não no bucket.** Se morasse no bucket, quem controla o bucket controlaria ao
 * mesmo tempo o arquivo e o hash esperado dele, e a verificação não provaria
 * nada. No git, os hashes têm histórico datado que qualquer pessoa audita.
 *
 * O espelho é sempre opcional e sempre verificado. Hash diferente do declarado,
 * arquivo ausente ou manifesto velho: cai para o DATASUS em silêncio, porque o
 * espelho é atalho, nunca fonte de verdade.
 */

export const MIRROR_MANIFEST_SCHEMA = 'tabwin-web.mirror';

export interface MirrorEntry {
  /** Nome do arquivo no catálogo oficial, ex.: `DNBR2024.dbc`. */
  name: string;
  /** Caminho dentro do bucket. */
  path: string;
  /** SHA-256 do `.dbc`, medido quando o espelho foi preenchido. */
  sha256: string;
  bytes: number;
  /** Quando este arquivo foi obtido do DATASUS. */
  fetchedAt: string;
  /** Endereço oficial de origem, para a procedência não depender do bucket. */
  source: string;
}

export interface MirrorManifestV1 {
  schema: typeof MIRROR_MANIFEST_SCHEMA;
  version: 1;
  /** Base pública do bucket, ex.: `https://espelho.tabweb.me`. */
  baseUrl: string;
  updatedAt: string;
  entries: MirrorEntry[];
}

/**
 * Idade máxima de um manifesto antes de ele deixar de valer.
 *
 * O DATASUS revisa os arquivos — o próprio TabNet declara datas de extração
 * distintas por ano. Um espelho congelado que continua servindo é o defeito
 * que a gente criticou noutro projeto; o prazo transforma "esqueci de
 * sincronizar" em "voltou a usar a fonte oficial".
 */
export const MIRROR_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

function texto(valor: unknown): string | undefined {
  return typeof valor === 'string' && valor.trim() ? valor.trim() : undefined;
}

/** Lê o manifesto, recusando alto o que não for um. */
export function parseMirrorManifest(conteudo: string): MirrorManifestV1 {
  let bruto: unknown;
  try {
    bruto = JSON.parse(conteudo);
  } catch {
    throw new Error('O manifesto do espelho não é JSON válido');
  }
  const objeto = bruto as Partial<MirrorManifestV1> | null;
  if (!objeto || objeto.schema !== MIRROR_MANIFEST_SCHEMA) {
    throw new Error('Este arquivo não é um manifesto de espelho do TabWin Web');
  }
  if (objeto.version !== 1) {
    throw new Error(`Manifesto de espelho na versão ${String(objeto.version)}, desconhecida`);
  }
  const baseUrl = texto(objeto.baseUrl);
  if (!baseUrl) throw new Error('O manifesto do espelho não declara baseUrl');
  if (!Array.isArray(objeto.entries)) throw new Error('O manifesto do espelho não traz entradas');

  const entries = objeto.entries.flatMap((item): MirrorEntry[] => {
    const registro = item as Partial<MirrorEntry> | null;
    const name = texto(registro?.name);
    const path = texto(registro?.path);
    const sha256 = texto(registro?.sha256);
    const source = texto(registro?.source);
    // Sem hash não há verificação, e sem verificação o espelho é só uma origem
    // não oficial. Uma entrada assim é pior que entrada nenhuma.
    if (!name || !path || !sha256 || !source) return [];
    if (!/^[0-9a-f]{64}$/.test(sha256)) return [];
    return [{
      name,
      path,
      sha256,
      bytes: Number(registro?.bytes) || 0,
      fetchedAt: texto(registro?.fetchedAt) ?? '',
      source,
    }];
  });

  return {
    schema: MIRROR_MANIFEST_SCHEMA,
    version: 1,
    baseUrl: baseUrl.replace(/\/$/, ''),
    updatedAt: texto(objeto.updatedAt) ?? '',
    entries,
  };
}

export interface MirrorLookup {
  url: string;
  sha256: string;
  bytes: number;
}

/**
 * Onde buscar um arquivo no espelho, se ele estiver lá e o manifesto valer.
 *
 * Devolve `null` sempre que houver qualquer dúvida — manifesto velho, arquivo
 * ausente, caminho suspeito. O chamador entende `null` como "vá ao DATASUS", e
 * é por isso que esta função nunca lança: um espelho indisponível não pode
 * impedir ninguém de baixar o dado.
 */
export function lookupInMirror(
  manifest: MirrorManifestV1,
  fileName: string,
  now = Date.now(),
  maxAgeMs = MIRROR_MAX_AGE_MS,
): MirrorLookup | null {
  const atualizadoEm = Date.parse(manifest.updatedAt);
  if (!Number.isFinite(atualizadoEm) || now - atualizadoEm > maxAgeMs) return null;

  const alvo = fileName.trim().toLowerCase();
  const entrada = manifest.entries.find((item) => item.name.toLowerCase() === alvo);
  if (!entrada) return null;

  // O caminho vem de um arquivo versionado, mas montar URL com texto de
  // arquivo pede cuidado: `..` ou uma URL absoluta no campo `path` fariam o
  // pedido sair do bucket declarado.
  if (entrada.path.includes('..') || /^[a-z]+:/i.test(entrada.path)) return null;

  return {
    url: `${manifest.baseUrl}/${entrada.path.replace(/^\//, '')}`,
    sha256: entrada.sha256,
    bytes: entrada.bytes,
  };
}

/** Descreve o estado do espelho para a tela, sem prometer o que não se sabe. */
export function describeMirror(manifest: MirrorManifestV1, now = Date.now()): string {
  const atualizadoEm = Date.parse(manifest.updatedAt);
  if (!Number.isFinite(atualizadoEm)) return 'Espelho sem data de atualização; não será usado.';
  const dias = Math.floor((now - atualizadoEm) / 86_400_000);
  const idade = dias <= 0 ? 'hoje' : `há ${dias} dia${dias > 1 ? 's' : ''}`;
  if (now - atualizadoEm > MIRROR_MAX_AGE_MS) {
    return `Espelho sincronizado ${idade} — velho demais para ser usado; o DATASUS responde.`;
  }
  return `Espelho com ${manifest.entries.length} arquivo(s), sincronizado ${idade}.`;
}
