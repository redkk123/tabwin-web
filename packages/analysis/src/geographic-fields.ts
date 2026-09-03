/**
 * Acha sozinho o campo geográfico de um arquivo do DATASUS.
 *
 * Existe por causa de um atrito bobo: o mapa só aparecia se a variável de
 * linha por acaso fosse de município ou UF. Quem tabulou por sexo abria a aba
 * Mapa e lia "escolha uma variável de município ou UF" — o aplicativo pedindo
 * à pessoa que fizesse o que ele já tinha como fazer.
 *
 * O nome do campo é **indício, não prova**. Cada sistema batiza do seu jeito
 * (`MUNIC_RES` no SIH, `CODMUNRES` no SIM e no SINASC, `ID_MN_RESI` no SINAN)
 * e nada impede um arquivo de trazer um campo chamado `MUNICIPIO` cheio de
 * texto livre. Por isso a função devolve candidatos **em ordem**, e quem chama
 * confirma com os dados: vale o primeiro cujos códigos casem de fato com o
 * mapa.
 *
 * A ordem privilegia **residência** sobre ocorrência. É escolha de domínio,
 * não de gosto: em epidemiologia a taxa é quase sempre por população
 * residente, e mapear ocorrência sem dizer produziria um mapa que parece o
 * esperado e responde outra pergunta — hospitais de referência concentram
 * internações de municípios vizinhos inteiros.
 */

/** Um campo candidato, com o nível geográfico que ele deve conter. */
export interface GeographicCandidate {
  field: string;
  level: 'municipality' | 'uf';
  /** Por que ele foi escolhido, para a tela poder dizer o que está mapeando. */
  reason: string;
}

/**
 * Nomes de campo de município, do mais para o menos preferido.
 *
 * Cada entrada é um padrão ancorado no nome inteiro; casar por pedaço faria
 * `CODMUNOCOR` (ocorrência) empatar com `CODMUNRES` (residência) e a ordem
 * deixaria de valer.
 */
const MUNICIPIO: readonly { padrao: RegExp; motivo: string }[] = [
  { padrao: /^(CODMUNRES|MUNIC_RES|ID_MN_RESI|MUNIC_RESID)$/i, motivo: 'município de residência' },
  { padrao: /^(CODMUNNASC)$/i, motivo: 'município de nascimento' },
  { padrao: /^(CODMUNOCOR|MUNIC_MOV|ID_MUNICIP|MUNIC_OCOR)$/i, motivo: 'município de ocorrência' },
  { padrao: /^(CODUFMUN|CODMUN|MUNICIPIO|MUNIC)$/i, motivo: 'município' },
];

const UNIDADE_FEDERACAO: readonly { padrao: RegExp; motivo: string }[] = [
  { padrao: /^(UFRES|SG_UF_RES|UF_RESID)$/i, motivo: 'UF de residência' },
  { padrao: /^(UF|UF_ZI|SG_UF|SG_UF_NOT|CODUF|ESTADO)$/i, motivo: 'unidade da federação' },
];

/**
 * Os campos que podem alimentar o mapa, do mais provável ao menos.
 *
 * Município vem antes de UF mesmo quando os dois existem, porque de um código
 * de município se obtém a UF (são os dois primeiros dígitos) e o contrário não
 * vale. Um só campo dá os dois níveis do mapa.
 */
export function findGeographicFields(fields: readonly { name: string }[]): GeographicCandidate[] {
  const nomes = fields.map((campo) => campo.name.trim()).filter(Boolean);
  const achados: GeographicCandidate[] = [];
  const usados = new Set<string>();

  const coletar = (lista: readonly { padrao: RegExp; motivo: string }[], level: 'municipality' | 'uf'): void => {
    for (const { padrao, motivo } of lista) {
      for (const nome of nomes) {
        if (usados.has(nome) || !padrao.test(nome)) continue;
        usados.add(nome);
        achados.push({ field: nome, level, reason: motivo });
      }
    }
  };

  coletar(MUNICIPIO, 'municipality');
  coletar(UNIDADE_FEDERACAO, 'uf');
  return achados;
}

/**
 * A UF de um código de município.
 *
 * O código do IBGE começa pelos dois dígitos da UF: `150140` é Belém, no Pará
 * (`15`). É essa regra que deixa um campo de município desenhar o mapa nacional
 * por estado e depois descer para os municípios de um estado só.
 *
 * Devolve `null` para o que não for um código plausível, em vez de arriscar
 * um palpite: um `0` ou um texto livre viraria a UF `0`, que não existe, e
 * mancharia o mapa com uma área fantasma.
 */
export function ufCodeOf(municipalityCode: string): string | null {
  const limpo = String(municipalityCode ?? '').trim();
  // Seis dígitos é o código do IBGE sem o dígito verificador, que é como o
  // DATASUS grava; sete é com ele, e aparece em arquivo já enriquecido.
  if (!/^\d{6,7}$/.test(limpo)) return null;
  const uf = limpo.slice(0, 2);
  // As UF do IBGE vão de 11 a 53, com buracos. O limite descarta lixo como
  // `00` e `99` sem precisar da lista inteira.
  const numero = Number(uf);
  return numero >= 11 && numero <= 53 ? uf : null;
}

/**
 * Se um código pertence a esta UF, para isolar um estado.
 *
 * Aceita tanto código de município (compara o prefixo) quanto código de UF
 * (compara igual), porque o mesmo filtro serve aos dois níveis do mapa.
 */
export function belongsToUf(code: string, ufCode: string): boolean {
  const limpo = String(code ?? '').trim();
  if (limpo === ufCode) return true;
  return ufCodeOf(limpo) === ufCode;
}
