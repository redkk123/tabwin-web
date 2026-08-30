/**
 * Human-readable labels for the field names that DATASUS microdata files
 * carry, so a raw DBC opened without a `.DEF` does not present the user with
 * a wall of `TP_NOT` / `CS_GESTANT` / `DIAG_PRINC`.
 *
 * Three boundaries that make this safe:
 *
 * 1. **Presentation only.** A label never participates in a tabulation, a
 *    filter, a conversion or an export value. Renaming `TP_NOT` on screen
 *    cannot change a single number. Nothing here is TabWin semantics.
 * 2. **A DEF always wins.** When a `.DEF` is loaded it declares the official
 *    label for that specific file, and that is what the UI shows. This
 *    dictionary is only the fallback for a file opened on its own.
 * 3. **The technical name is never hidden.** The UI renders
 *    `Tipo de notificação · TP_NOT`, so anyone who knows the layout - or is
 *    checking against the official dictionary - still sees the real name.
 *
 * Entries come from the published DATASUS data dictionaries for each system.
 * A name absent from here simply shows as itself; that is the honest default,
 * and it is why the map is deliberately conservative rather than exhaustive.
 */

/**
 * Field name (uppercase) to label. Names shared across systems - `SEXO`,
 * `IDADE`, `RACACOR`, `DTNASC` - mean the same thing in each, so one entry
 * serves them all.
 */
const FIELD_LABELS: Readonly<Record<string, string>> = {
  // --- SINAN: notification form core, common to every agravo ---
  TP_NOT: 'Tipo de notificação',
  ID_AGRAVO: 'Agravo/doença (CID)',
  DT_NOTIFIC: 'Data da notificação',
  SEM_NOT: 'Semana epidemiológica da notificação',
  NU_ANO: 'Ano da notificação',
  SG_UF_NOT: 'UF de notificação',
  ID_MUNICIP: 'Município de notificação',
  ID_REGIONA: 'Regional de saúde de notificação',
  ID_UNIDADE: 'Unidade de saúde de notificação',
  DT_SIN_PRI: 'Data dos primeiros sintomas',
  SEM_PRI: 'Semana epidemiológica dos primeiros sintomas',
  DT_INVEST: 'Data da investigação',
  DT_ENCERRA: 'Data do encerramento',
  DT_DIGITA: 'Data da digitação',
  CLASSI_FIN: 'Classificação final',
  CRITERIO: 'Critério de confirmação',
  EVOLUCAO: 'Evolução do caso',
  TPAUTOCTO: 'Caso autóctone',
  COUFINF: 'UF provável de infecção',
  COMUNINF: 'Município provável de infecção',

  // --- Person: SINAN spellings ---
  ANO_NASC: 'Ano de nascimento',
  NU_IDADE_N: 'Idade',
  CS_SEXO: 'Sexo',
  CS_GESTANT: 'Gestante',
  CS_RACA: 'Raça/cor',
  CS_ESCOL_N: 'Escolaridade',
  CS_ZONA: 'Zona de residência',
  SG_UF: 'UF de residência',
  ID_MN_RESI: 'Município de residência',
  ID_RG_RESI: 'Regional de saúde de residência',
  ID_PAIS: 'País de residência',
  NM_BAIRRO: 'Bairro de residência',
  ID_OCUPA_N: 'Ocupação',

  // --- Person: spellings shared by SIM, SINASC and SIH ---
  SEXO: 'Sexo',
  IDADE: 'Idade',
  RACACOR: 'Raça/cor',
  DTNASC: 'Data de nascimento',
  ESTCIV: 'Estado civil',
  ESC: 'Escolaridade',
  OCUP: 'Ocupação',

  // --- SIM: mortality ---
  DTOBITO: 'Data do óbito',
  HORAOBITO: 'Hora do óbito',
  CODMUNRES: 'Município de residência',
  CODMUNOCOR: 'Município de ocorrência',
  CAUSABAS: 'Causa básica (CID-10)',
  LOCOCOR: 'Local de ocorrência',
  CIRCOBITO: 'Circunstância do óbito',
  ASSISTMED: 'Assistência médica',
  NECROPSIA: 'Necropsia',
  OBITOGRAV: 'Óbito na gravidez',
  OBITOPUERP: 'Óbito no puerpério',

  // --- SINASC: live births ---
  CODMUNNASC: 'Município de nascimento',
  PESO: 'Peso ao nascer',
  IDADEMAE: 'Idade da mãe',
  ESCMAE: 'Escolaridade da mãe',
  CONSULTAS: 'Consultas de pré-natal',
  GESTACAO: 'Semanas de gestação',
  GRAVIDEZ: 'Tipo de gravidez',
  PARTO: 'Tipo de parto',
  APGAR1: 'Apgar no 1º minuto',
  APGAR5: 'Apgar no 5º minuto',
  QTDFILVIVO: 'Filhos vivos',
  QTDFILMORT: 'Perdas fetais/abortos',

  // --- SIH: hospital admissions ---
  N_AIH: 'Número da AIH',
  ANO_CMPT: 'Ano de competência',
  MES_CMPT: 'Mês de competência',
  UF_ZI: 'UF do gestor',
  MUNIC_RES: 'Município de residência',
  MUNIC_MOV: 'Município do estabelecimento',
  DT_INTER: 'Data da internação',
  DT_SAIDA: 'Data da saída',
  DIAS_PERM: 'Dias de permanência',
  DIAG_PRINC: 'Diagnóstico principal (CID-10)',
  DIAG_SECUN: 'Diagnóstico secundário (CID-10)',
  PROC_REA: 'Procedimento realizado',
  VAL_TOT: 'Valor total',
  VAL_SH: 'Valor de serviços hospitalares',
  VAL_SP: 'Valor de serviços profissionais',
  VAL_UTI: 'Valor de UTI',
  UTI_MES_TO: 'Diárias de UTI',
  MORTE: 'Óbito',
  CAR_INT: 'Caráter do atendimento',
  ESPEC: 'Especialidade do leito',
  COMPLEX: 'Complexidade',
  CNES: 'Estabelecimento (CNES)',
  CGC_HOSP: 'CNPJ do estabelecimento',
  NAT_JUR: 'Natureza jurídica',
  GESTAO: 'Tipo de gestão',
  IND_VDRL: 'VDRL',
  INFEHOSP: 'Infecção hospitalar',

  // --- CNES: establishments ---
  FANTASIA: 'Nome fantasia',
  NOMEFANT: 'Nome fantasia',
  RAZAOSOCIAL: 'Razão social',
  TPGESTAO: 'Tipo de gestão',
};

/**
 * The published label for a DATASUS field name, or `undefined` when the name
 * is not in the dictionary - in which case the caller shows the raw name,
 * which is always the honest fallback.
 */
export function datasusFieldLabel(fieldName: string): string | undefined {
  return FIELD_LABELS[fieldName.trim().toUpperCase()];
}

/** How many names the dictionary covers, for the UI to disclose its own reach. */
export function datasusFieldLabelCount(): number {
  return Object.keys(FIELD_LABELS).length;
}
