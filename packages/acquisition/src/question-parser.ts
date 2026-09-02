/**
 * Traduz uma pergunta em português para uma consulta ao catálogo do DATASUS.
 *
 * Hoje a primeira tela pede que a pessoa já saiba o vocabulário do portal:
 * sistema, tipo de arquivo, ano, UF. Quem conhece DATASUS sabe que óbito
 * infantil é `SIM/DOINF`; quem não conhece não tem por onde começar, e é a
 * maioria de quem precisa do dado. Eliminamos o FTP; falta eliminar o jargão.
 *
 * O casamento é por sobreposição de termos contra os rótulos que o catálogo já
 * tem, mais uma tabela de sinônimos com o que as pessoas realmente escrevem —
 * "morte" por óbito, "parto" por nascimento, "AIH" por internação. Essa tabela
 * é conhecimento de domínio, não engenharia: cada linha existe porque alguém
 * escreveria aquilo.
 *
 * O resultado é sempre uma LISTA ordenada, nunca um palpite único. Quando a
 * pergunta é ambígua — "câncer" existe em três sistemas — mostrar as opções é
 * mais honesto do que escolher por ela e errar em silêncio.
 */

import { DATASUS_FILE_TYPES, DATASUS_SYSTEMS, systemIsAnnual } from './datasus.js';

export interface QuestionMatch {
  system: string;
  fileType: string;
  /** Rótulo pronto para a tela: "SIM · Óbitos infantis". */
  label: string;
  year?: string;
  uf?: string;
  /** 0..100. Força da evidência, para ordenar — não é probabilidade. */
  score: number;
  /** O que na pergunta levou a este resultado, para a pessoa conferir. */
  because: string[];
}

export interface ParsedQuestion {
  /** O que sobrou depois de extrair ano e UF; é o que casa com os rótulos. */
  subject: string;
  year?: string;
  uf?: string;
  matches: QuestionMatch[];
}

const UF_NAMES: Readonly<Record<string, string>> = {
  acre: 'AC', alagoas: 'AL', amapa: 'AP', amazonas: 'AM', bahia: 'BA',
  ceara: 'CE', 'distrito federal': 'DF', df: 'DF', 'espirito santo': 'ES',
  goias: 'GO', maranhao: 'MA', 'mato grosso': 'MT', 'mato grosso do sul': 'MS',
  'minas gerais': 'MG', para: 'PA', paraiba: 'PB', parana: 'PR',
  pernambuco: 'PE', piaui: 'PI', 'rio de janeiro': 'RJ',
  'rio grande do norte': 'RN', 'rio grande do sul': 'RS', rondonia: 'RO',
  roraima: 'RR', 'santa catarina': 'SC', 'sao paulo': 'SP', sergipe: 'SE',
  tocantins: 'TO', brasil: 'BR', nacional: 'BR',
};

const SIGLAS = new Set(Object.values(UF_NAMES));

/**
 * O que as pessoas escrevem, e o que aquilo significa no catálogo.
 *
 * Cada entrada é uma palavra que alguém digitaria, apontando para termos que
 * aparecem nos rótulos oficiais. Não é dicionário médico: é o vão entre a
 * língua de quem pergunta e a de quem catalogou.
 */
const SINONIMOS: Readonly<Record<string, readonly string[]>> = {
  morte: ['obito'], mortes: ['obito'], mortalidade: ['obito'],
  falecimento: ['obito'], falecimentos: ['obito'], morreu: ['obito'],
  natalidade: ['nascidos', 'vivos'], nascimento: ['nascidos', 'vivos'],
  nascimentos: ['nascidos', 'vivos'], parto: ['nascidos', 'vivos'],
  partos: ['nascidos', 'vivos'], bebe: ['nascidos', 'vivos'],
  neonatal: ['obitos', 'infantis'], infantil: ['infantis'],
  crianca: ['infantis'], criancas: ['infantis'], bebes: ['infantis'],
  materna: ['maternos'], gestante: ['maternos'], gravida: ['maternos'],
  internacao: ['aih'], internacoes: ['aih'], hospitalar: ['aih'],
  hospitalizacao: ['aih'], leito: ['aih'], leitos: ['aih'],
  ambulatorio: ['ambulatorial'], consulta: ['ambulatorial'],
  consultas: ['ambulatorial'], procedimento: ['ambulatorial'],
  hospital: ['estabelecimentos'], hospitais: ['estabelecimentos'],
  posto: ['estabelecimentos'], unidade: ['estabelecimentos'],
  quimio: ['quimioterapia'], radio: ['radioterapia'],
  aids: ['aids'], hiv: ['hiv'], tb: ['tuberculose'],
  acidente: ['acidente'], violencia: ['violencia'],
  suicidio: ['violencia'], intoxicacao: ['intoxicacao'],
  zika: ['zika'], chikungunya: ['chikungunya'], chik: ['chikungunya'],
  barbeiro: ['chagas'], tripanossomiase: ['chagas'],
};

/**
 * Códigos CID-10 que apontam direto para um agravo do SINAN.
 *
 * Curto de propósito: só os que têm arquivo próprio no catálogo. Um CID que
 * não está aqui continua servindo como texto de busca.
 */
const CID_PARA_AGRAVO: Readonly<Record<string, string>> = {
  A90: 'DENG', A92: 'CHIK', A928: 'ZIKA', U06: 'ZIKA',
  B57: 'CHAG', A27: 'LEPT', B55: 'LEIV', A30: 'HANS',
  B50: 'MALA', B51: 'MALA', B52: 'MALA', B53: 'MALA', B54: 'MALA',
  A15: 'TUBE', A16: 'TUBE', A17: 'TUBE', A18: 'TUBE', A19: 'TUBE',
  A95: 'FAMA', B20: 'AIDA', B24: 'AIDA',
};

/** Sem acento, minúsculo, sem pontuação: a forma em que tudo é comparado. */
function normalizar(texto: string): string {
  return texto.normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
}

function termos(texto: string): string[] {
  // Termos de uma letra só não distinguem nada e poluiriam toda pontuação.
  return normalizar(texto).split(' ').filter((t) => t.length > 1);
}

/** Extrai o ano, se houver um plausível. Aceita "2023" e "de 2023". */
function acharAno(texto: string): string | undefined {
  const anos = [...texto.matchAll(/\b(19[89]\d|20[0-4]\d)\b/g)].map((m) => m[1]!);
  // O mais recente ganha: em "2020 a 2023" quem pergunta costuma querer o fim.
  return anos.length ? anos.sort().at(-1) : undefined;
}

/** Extrai a UF por sigla ou por nome do estado. */
function acharUf(texto: string): { uf?: string; consumido?: string } {
  const limpo = normalizar(texto);
  // Nome inteiro antes de sigla: "mato grosso do sul" não pode virar "MS" via
  // "ms" solto nem "MT" via "mato grosso", que é prefixo dele.
  const nomes = Object.keys(UF_NAMES).sort((a, b) => b.length - a.length);
  for (const nome of nomes) {
    if (new RegExp(`\\b${nome}\\b`).test(limpo)) {
      const sigla = UF_NAMES[nome];
      if (sigla) return { uf: sigla, consumido: nome };
    }
  }
  for (const palavra of limpo.split(' ')) {
    const sigla = palavra.toUpperCase();
    if (palavra.length === 2 && SIGLAS.has(sigla)) return { uf: sigla, consumido: palavra };
  }
  return {};
}

/** Expande os termos da pergunta com os sinônimos que eles disparam. */
function expandir(entrada: readonly string[]): string[] {
  const saida = new Set(entrada);
  for (const termo of entrada) for (const extra of SINONIMOS[termo] ?? []) saida.add(extra);
  return [...saida];
}

interface Alvo {
  system: string;
  fileType: string;
  label: string;
  termos: Set<string>;
  coverage: 'UF' | 'BR' | 'BOTH';
}

/** Cada tipo de arquivo vira um alvo, com os termos do seu rótulo e do sistema. */
function alvos(): Alvo[] {
  const rotuloDoSistema = new Map(DATASUS_SYSTEMS.map((s) => [s.code, s.label]));
  return DATASUS_FILE_TYPES.map((tipo) => {
    const sistema = rotuloDoSistema.get(tipo.system) ?? tipo.system;
    return {
      system: tipo.system,
      fileType: tipo.code,
      label: `${tipo.system} · ${tipo.label}`,
      coverage: tipo.coverage,
      termos: new Set([
        ...termos(tipo.label),
        ...termos(sistema),
        tipo.code.toLowerCase(),
        tipo.system.toLowerCase(),
      ]),
    };
  });
}

const ALVOS = alvos();

export function parseQuestion(pergunta: string, limite = 6): ParsedQuestion {
  const ano = acharAno(pergunta);
  const { uf, consumido } = acharUf(pergunta);

  // Ano e UF saem do texto: se ficassem, "2023" competiria com rótulos e "SP"
  // casaria com o tipo de arquivo SP do SIH, que é serviço profissional.
  let resto = pergunta;
  if (ano) resto = resto.replace(new RegExp(`\\b${ano}\\b`, 'g'), ' ');
  const restoNormalizado = consumido
    ? normalizar(resto).replace(new RegExp(`\\b${consumido}\\b`, 'g'), ' ')
    : normalizar(resto);

  const base = termos(restoNormalizado);
  const buscados = expandir(base);
  const subject = base.join(' ');

  // Um CID reconhecido aponta direto, e vale mais que qualquer casamento de
  // texto: quem digita A90 sabe exatamente o que quer.
  const cid = /\b([a-zA-Z]\d{2,3})\b/.exec(normalizar(pergunta).toUpperCase());
  const agravo = cid ? CID_PARA_AGRAVO[cid[1]!.toUpperCase()] : undefined;

  const encontrados = ALVOS.flatMap((alvo): QuestionMatch[] => {
    const casados = buscados.filter((t) => alvo.termos.has(t));
    const porCid = agravo !== undefined && alvo.fileType === agravo;
    if (!casados.length && !porCid) return [];

    // Fração dos termos do rótulo cobertos: prefere o alvo específico ao
    // genérico. "óbitos infantis" cobre 2 de 2 em DOINF e 1 de 2 em DO.
    const cobertura = casados.length / Math.max(1, alvo.termos.size);
    const bruto = casados.length * 22 + cobertura * 40 + (porCid ? 70 : 0);
    const because = casados.length ? [`termos: ${casados.join(', ')}`] : [];
    if (porCid) because.unshift(`código ${cid![1]!.toUpperCase()}`);

    return [{
      system: alvo.system,
      fileType: alvo.fileType,
      label: alvo.label,
      ...(ano ? { year: ano } : {}),
      // Arquivo só nacional ignora a UF pedida; forçá-la daria busca vazia.
      ...(uf && alvo.coverage !== 'BR' ? { uf } : {}),
      ...(alvo.coverage === 'BR' ? { uf: 'BR' } : {}),
      score: Math.min(100, Math.round(bruto)),
      because,
    }];
  });

  encontrados.sort((a, b) => b.score - a.score || a.label.localeCompare(b.label));
  return {
    subject,
    ...(ano ? { year: ano } : {}),
    ...(uf ? { uf } : {}),
    matches: encontrados.slice(0, limite),
  };
}

/** Uma frase curta dizendo como a pergunta foi lida, para a pessoa conferir. */
export function describeParsedQuestion(parsed: ParsedQuestion): string {
  if (!parsed.matches.length) return 'Não reconheci nenhum conjunto para esta pergunta.';
  const melhor = parsed.matches[0]!;
  const partes = [melhor.label];
  if (melhor.year) partes.push(melhor.year);
  else if (systemIsAnnual(melhor.system)) partes.push('ano a escolher');
  if (melhor.uf) partes.push(melhor.uf === 'BR' ? 'Brasil' : melhor.uf);
  return partes.join(' · ');
}
