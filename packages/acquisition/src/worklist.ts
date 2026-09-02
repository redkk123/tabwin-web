/**
 * Lista de trabalho portátil: o que falta baixar, e o que já está aqui.
 *
 * Baixar microdado do DATASUS é lento e ninguém faz de uma vez. A pesquisa
 * acontece em sessões, às vezes em aparelhos diferentes — o notebook do
 * laboratório hoje, o de casa amanhã. Sem memória, cada sessão recomeça de
 * "quais arquivos mesmo eu precisava?", e a resposta mora num caderno.
 *
 * Diferente do manifesto de consulta, que registra o que **aconteceu** numa
 * busca: aqui o registro é do que se **quer**, e sobrevive à sessão. Levar o
 * arquivo para outro aparelho é levar a intenção junto.
 *
 * O que já foi baixado é reconhecido por SHA-256, não por nome: o portal
 * entrega tudo como `arquivo.zip` e o mesmo dado chega com três nomes. Ver
 * `known-archive.ts`, que resolve o mesmo problema na abertura avulsa.
 */

export const WORKLIST_SCHEMA = 'tabwin-web.worklist';

export interface WorklistItem {
  /** Nome do arquivo no catálogo oficial, ex.: `RDPR2401.dbc`. */
  name: string;
  system: string;
  fileType: string;
  year?: string;
  month?: string;
  uf?: string;
  /** Endereço oficial, guardado para a busca não precisar ser refeita. */
  address?: string;
  /** Impressão do conteúdo, quando este item já foi baixado alguma vez. */
  sha256?: string;
}

export interface WorklistV1 {
  schema: typeof WORKLIST_SCHEMA;
  version: 1;
  createdAt: string;
  /** Como a pessoa chama este trabalho: "Chagas nacional 2008–2024". */
  label: string;
  items: WorklistItem[];
}

export interface WorklistPlan {
  /** Itens cujo conteúdo já está guardado neste aparelho. */
  present: WorklistItem[];
  /** Itens que ainda precisam ser baixados. */
  missing: WorklistItem[];
  /** Itens sem impressão registrada: podem estar aqui, não dá para afirmar. */
  unknown: WorklistItem[];
}

function texto(valor: unknown): string | undefined {
  return typeof valor === 'string' && valor.trim() ? valor.trim() : undefined;
}

export function createWorklist(
  label: string,
  items: readonly WorklistItem[],
  createdAt = new Date().toISOString(),
): WorklistV1 {
  return {
    schema: WORKLIST_SCHEMA,
    version: 1,
    createdAt,
    label: label.trim() || 'Sem título',
    // Um arquivo por nome: pedir o mesmo duas vezes é sempre engano, e
    // deduplicar aqui evita que o engano vire download repetido.
    items: [...new Map(items.map((item) => [item.name.toLowerCase(), item])).values()],
  };
}

export function serializeWorklist(worklist: WorklistV1): string {
  return `${JSON.stringify(worklist, null, 2)}\n`;
}

/**
 * Lê uma lista de trabalho, recusando o que não é uma.
 *
 * Recusa alto em vez de aceitar parcialmente: uma lista lida pela metade
 * faria a pessoa acreditar que pediu menos arquivos do que pediu.
 */
export function parseWorklist(conteudo: string): WorklistV1 {
  let bruto: unknown;
  try {
    bruto = JSON.parse(conteudo);
  } catch {
    throw new Error('Este arquivo não é uma lista de trabalho: não é JSON válido');
  }
  const objeto = bruto as Partial<WorklistV1> | null;
  if (!objeto || objeto.schema !== WORKLIST_SCHEMA) {
    throw new Error('Este arquivo não é uma lista de trabalho do TabWin Web');
  }
  if (objeto.version !== 1) {
    throw new Error(`Lista de trabalho na versão ${String(objeto.version)}, que este programa não conhece`);
  }
  if (!Array.isArray(objeto.items)) {
    throw new Error('A lista de trabalho não traz itens');
  }

  const items = objeto.items.flatMap((item): WorklistItem[] => {
    const registro = item as Partial<WorklistItem> | null;
    const name = texto(registro?.name);
    const system = texto(registro?.system);
    const fileType = texto(registro?.fileType);
    // Sem nome, sistema e tipo não há o que baixar: o item é ruído.
    if (!name || !system || !fileType) return [];
    return [{
      name,
      system,
      fileType,
      ...(texto(registro?.year) ? { year: texto(registro?.year)! } : {}),
      ...(texto(registro?.month) ? { month: texto(registro?.month)! } : {}),
      ...(texto(registro?.uf) ? { uf: texto(registro?.uf)! } : {}),
      ...(texto(registro?.address) ? { address: texto(registro?.address)! } : {}),
      ...(texto(registro?.sha256) ? { sha256: texto(registro?.sha256)! } : {}),
    }];
  });

  if (!items.length) throw new Error('A lista de trabalho não traz nenhum item utilizável');

  return {
    schema: WORKLIST_SCHEMA,
    version: 1,
    createdAt: texto(objeto.createdAt) ?? new Date().toISOString(),
    label: texto(objeto.label) ?? 'Sem título',
    items,
  };
}

/**
 * Separa o que já está aqui do que falta.
 *
 * Três grupos, não dois. Um item sem impressão registrada não é "falta": é
 * "não dá para saber" — pode já estar no aparelho sob outro nome. Chamar isso
 * de ausente mandaria a pessoa rebaixar o que ela já tem.
 */
export function planWorklist(
  worklist: WorklistV1,
  hashesLocais: Iterable<string>,
): WorklistPlan {
  const locais = new Set([...hashesLocais].filter(Boolean));
  const present: WorklistItem[] = [];
  const missing: WorklistItem[] = [];
  const unknown: WorklistItem[] = [];
  for (const item of worklist.items) {
    if (!item.sha256) unknown.push(item);
    else if (locais.has(item.sha256)) present.push(item);
    else missing.push(item);
  }
  return { present, missing, unknown };
}

/** Uma frase dizendo em que pé está o trabalho. */
export function describeWorklistPlan(worklist: WorklistV1, plan: WorklistPlan): string {
  const total = worklist.items.length;
  const partes = [`${plan.present.length} de ${total} já neste aparelho`];
  if (plan.missing.length) partes.push(`${plan.missing.length} a baixar`);
  if (plan.unknown.length) partes.push(`${plan.unknown.length} sem impressão registrada`);
  return `${worklist.label}: ${partes.join(' · ')}`;
}
