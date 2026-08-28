/**
 * Official DATASUS file-transfer adapter.
 *
 * This package only discovers and prepares source files. It deliberately has
 * no dependency on AnalysisSpec, QueryPlan or execution semantics.
 */

export const DATASUS_TRANSFER_ENDPOINT = 'https://datasus.saude.gov.br/wp-content/ftp.php';
export const DATASUS_DOWNLOAD_ENDPOINT = 'https://datasus.saude.gov.br/wp-content/download.php';

export interface DatasusSystem {
  code: string;
  label: string;
  annual?: boolean;
}

export interface DatasusFileType {
  system: string;
  code: string;
  label: string;
  coverage: 'UF' | 'BR' | 'BOTH';
}

export interface DatasusSearchQuery {
  system: string;
  fileType: string;
  year: string;
  month?: string;
  uf?: string;
}

export interface DatasusRemoteFile {
  source: string;
  modality: string;
  name: string;
  address: string;
  /** Explicit official catalog tuple, retained for source-level provenance. */
  catalogQuery?: DatasusSearchQuery;
}

/** Explicit expansion of a multi-period catalog selection. */
export interface DatasusSearchSelection {
  system: string;
  fileType: string;
  years: readonly string[];
  months?: readonly string[];
  ufs?: readonly string[];
  annual?: boolean;
}

export interface DatasusCatalogCapabilities {
  system: DatasusSystem;
  fileType: DatasusFileType;
  periodicity: 'annual' | 'monthly';
  geographies: Array<'BR' | 'UF'>;
  multiplePeriods: true;
  multipleUfs: boolean;
  availability: 'verified-at-query-time';
  auxiliaryResolution: 'verified-automatic' | 'explicit-manual';
}

export interface DatasusCatalogQueryResult {
  query: DatasusSearchQuery;
  files: readonly DatasusRemoteFile[];
}

export interface DatasusAvailabilityManifest {
  requestedQueries: number;
  availableQueries: number;
  missingQueries: DatasusSearchQuery[];
  fileCount: number;
  entries: Array<{
    query: DatasusSearchQuery;
    status: 'available' | 'missing';
    files: Array<Pick<DatasusRemoteFile, 'name' | 'address'>>;
  }>;
}

export interface DatasusSourceManifestV1 {
  schema: 'tabwin-web.source-manifest';
  version: 1;
  createdAt: string;
  system: string;
  fileType: string;
  availability: DatasusAvailabilityManifest;
}

export interface DatasusSourceManifestDiff {
  addedFiles: Array<Pick<DatasusRemoteFile, 'name' | 'address'>>;
  removedFiles: Array<Pick<DatasusRemoteFile, 'name' | 'address'>>;
  unchangedFiles: Array<Pick<DatasusRemoteFile, 'name' | 'address'>>;
  newlyAvailableQueries: DatasusSearchQuery[];
  newlyMissingQueries: DatasusSearchQuery[];
}

/** Catalog facts published by the official Transferencia de Arquivos page. */
export const DATASUS_SYSTEMS: readonly DatasusSystem[] = [
  { code: 'SIHSUS', label: 'SIH/SUS · Internações hospitalares' },
  { code: 'SIASUS', label: 'SIA/SUS · Produção ambulatorial' },
  { code: 'SIM', label: 'SIM · Mortalidade', annual: true },
  { code: 'SINASC', label: 'SINASC · Nascidos vivos', annual: true },
  { code: 'CNES', label: 'CNES · Estabelecimentos de saúde' },
  { code: 'SINAN', label: 'SINAN · Agravos de notificação', annual: true },
  { code: 'CIHA', label: 'CIHA · Internação hospitalar e ambulatorial' },
  { code: 'CIH', label: 'CIH · Comunicação de internação hospitalar' },
  { code: 'SISCOLO', label: 'SISCOLO · Câncer do colo do útero' },
  { code: 'SISMAMA', label: 'SISMAMA · Câncer de mama' },
  { code: 'SISPRENATAL', label: 'SISPRENATAL · Pré-natal' },
  { code: 'ESUSNOTIFICA', label: 'e-SUS Notifica · Chagas crônica', annual: true },
  { code: 'RESP', label: 'RESP · Síndrome congênita associada ao Zika', annual: true },
  { code: 'PO', label: 'Painel de Oncologia', annual: true },
  { code: 'PCE', label: 'PCE · Controle da esquistossomose', annual: true },
  { code: 'IBGE', label: 'IBGE · Bases populacionais', annual: true },
] as const;

export const DATASUS_FILE_TYPES: readonly DatasusFileType[] = [
  { system: 'SIHSUS', code: 'RD', label: 'AIH reduzida', coverage: 'UF' },
  { system: 'SIHSUS', code: 'RJ', label: 'AIH rejeitadas', coverage: 'UF' },
  { system: 'SIHSUS', code: 'SP', label: 'Serviços profissionais', coverage: 'UF' },
  { system: 'SIHSUS', code: 'ER', label: 'AIH rejeitadas com código de erro', coverage: 'UF' },
  { system: 'SIASUS', code: 'PA', label: 'Produção ambulatorial', coverage: 'UF' },
  { system: 'SIASUS', code: 'AM', label: 'APAC de medicamentos', coverage: 'UF' },
  { system: 'SIASUS', code: 'AQ', label: 'APAC de quimioterapia', coverage: 'UF' },
  { system: 'SIASUS', code: 'AR', label: 'APAC de radioterapia', coverage: 'UF' },
  { system: 'SIASUS', code: 'AD', label: 'APAC de laudos diversos', coverage: 'UF' },
  { system: 'SIASUS', code: 'ABO', label: 'APAC pós-cirurgia bariátrica', coverage: 'UF' },
  { system: 'SIASUS', code: 'ACF', label: 'APAC de fístula arteriovenosa', coverage: 'UF' },
  { system: 'SIASUS', code: 'ATD', label: 'APAC de tratamento dialítico', coverage: 'UF' },
  { system: 'SIASUS', code: 'PS', label: 'Atenção psicossocial', coverage: 'UF' },
  { system: 'SIASUS', code: 'SAD', label: 'Atenção domiciliar', coverage: 'UF' },
  { system: 'SIM', code: 'DO', label: 'Declarações de óbito', coverage: 'BOTH' },
  { system: 'SIM', code: 'DOFET', label: 'Óbitos fetais', coverage: 'BR' },
  { system: 'SIM', code: 'DOEXT', label: 'Óbitos por causas externas', coverage: 'BR' },
  { system: 'SIM', code: 'DOINF', label: 'Óbitos infantis', coverage: 'BR' },
  { system: 'SIM', code: 'DOMAT', label: 'Óbitos maternos', coverage: 'BR' },
  { system: 'SINASC', code: 'DN', label: 'Declarações de nascidos vivos', coverage: 'BOTH' },
  { system: 'SINASC', code: 'DNEX', label: 'Nascidos vivos residentes no exterior', coverage: 'BR' },
  { system: 'CNES', code: 'ST', label: 'Estabelecimentos', coverage: 'UF' },
  { system: 'CNES', code: 'LT', label: 'Leitos', coverage: 'UF' },
  { system: 'CNES', code: 'DC', label: 'Dados complementares', coverage: 'UF' },
  { system: 'CNES', code: 'EQ', label: 'Equipamentos', coverage: 'UF' },
  { system: 'CNES', code: 'SR', label: 'Serviços especializados', coverage: 'UF' },
  { system: 'CNES', code: 'HB', label: 'Habilitações', coverage: 'UF' },
  { system: 'CNES', code: 'PF', label: 'Profissionais', coverage: 'UF' },
  { system: 'CNES', code: 'EP', label: 'Equipes', coverage: 'UF' },
  { system: 'CNES', code: 'RC', label: 'Regras contratuais', coverage: 'UF' },
  { system: 'SINAN', code: 'ACBI', label: 'Acidente de trabalho com material biológico', coverage: 'BR' },
  { system: 'SINAN', code: 'ACGR', label: 'Acidente de trabalho', coverage: 'BR' },
  { system: 'SINAN', code: 'AIDA', label: 'AIDS em adultos', coverage: 'BR' },
  { system: 'SINAN', code: 'AIDC', label: 'AIDS em crianças', coverage: 'BR' },
  { system: 'SINAN', code: 'ANIM', label: 'Acidente por animais peçonhentos', coverage: 'BR' },
  { system: 'SINAN', code: 'ANTR', label: 'Atendimento antirrábico', coverage: 'BR' },
  { system: 'SINAN', code: 'BOTU', label: 'Botulismo', coverage: 'BR' },
  { system: 'SINAN', code: 'CANC', label: 'Câncer relacionado ao trabalho', coverage: 'BR' },
  { system: 'SINAN', code: 'CHAG', label: 'Doença de Chagas aguda', coverage: 'BR' },
  { system: 'SINAN', code: 'CHIK', label: 'Febre de Chikungunya', coverage: 'BR' },
  { system: 'SINAN', code: 'COLE', label: 'Cólera', coverage: 'BR' },
  { system: 'SINAN', code: 'COQU', label: 'Coqueluche', coverage: 'BR' },
  { system: 'SINAN', code: 'DCRJ', label: 'Doença de Creutzfeldt-Jakob', coverage: 'BR' },
  { system: 'SINAN', code: 'DENG', label: 'Dengue', coverage: 'BR' },
  { system: 'SINAN', code: 'DERM', label: 'Dermatoses ocupacionais', coverage: 'BR' },
  { system: 'SINAN', code: 'DIFT', label: 'Difteria', coverage: 'BR' },
  { system: 'SINAN', code: 'ESPO', label: 'Esporotricose (epizootia)', coverage: 'BR' },
  { system: 'SINAN', code: 'ESQU', label: 'Esquistossomose', coverage: 'BR' },
  { system: 'SINAN', code: 'EXAN', label: 'Doenças exantemáticas', coverage: 'BR' },
  { system: 'SINAN', code: 'FMAC', label: 'Febre maculosa', coverage: 'BR' },
  { system: 'SINAN', code: 'FTIF', label: 'Febre tifoide', coverage: 'BR' },
  { system: 'SINAN', code: 'HANS', label: 'Hanseníase', coverage: 'BR' },
  { system: 'SINAN', code: 'HANT', label: 'Hantavirose', coverage: 'BR' },
  { system: 'SINAN', code: 'HEPA', label: 'Hepatites virais', coverage: 'BR' },
  { system: 'SINAN', code: 'HIVA', label: 'HIV em adultos', coverage: 'BR' },
  { system: 'SINAN', code: 'HIVC', label: 'HIV em crianças', coverage: 'BR' },
  { system: 'SINAN', code: 'HIVE', label: 'HIV em crianças expostas', coverage: 'BR' },
  { system: 'SINAN', code: 'HIVG', label: 'HIV em gestante', coverage: 'BR' },
  { system: 'SINAN', code: 'IEXO', label: 'Intoxicação exógena', coverage: 'BR' },
  { system: 'SINAN', code: 'INFL', label: 'Influenza pandêmica', coverage: 'BR' },
  { system: 'SINAN', code: 'LEIV', label: 'Leishmaniose visceral', coverage: 'BR' },
  { system: 'SINAN', code: 'LEPT', label: 'Leptospirose', coverage: 'BR' },
  { system: 'SINAN', code: 'LERD', label: 'LER/Dort', coverage: 'BR' },
  { system: 'SINAN', code: 'LTAN', label: 'Leishmaniose tegumentar americana', coverage: 'BR' },
  { system: 'SINAN', code: 'MALA', label: 'Malária', coverage: 'BR' },
  { system: 'SINAN', code: 'MENI', label: 'Meningite', coverage: 'BR' },
  { system: 'SINAN', code: 'MENT', label: 'Transtornos mentais relacionados ao trabalho', coverage: 'BR' },
  { system: 'SINAN', code: 'NTRA', label: 'Notificação de tracoma', coverage: 'BR' },
  { system: 'SINAN', code: 'PAIR', label: 'Perda auditiva por ruído relacionada ao trabalho', coverage: 'BR' },
  { system: 'SINAN', code: 'PEST', label: 'Peste', coverage: 'BR' },
  { system: 'SINAN', code: 'PFAN', label: 'Paralisia flácida aguda', coverage: 'BR' },
  { system: 'SINAN', code: 'PNEU', label: 'Pneumoconioses relacionadas ao trabalho', coverage: 'BR' },
  { system: 'SINAN', code: 'RAIV', label: 'Raiva', coverage: 'BR' },
  { system: 'SINAN', code: 'ROTA', label: 'Rotavírus', coverage: 'BR' },
  { system: 'SINAN', code: 'SDTA', label: 'Surto de doenças transmitidas por alimentos', coverage: 'BR' },
  { system: 'SINAN', code: 'SIFA', label: 'Sífilis adquirida', coverage: 'BR' },
  { system: 'SINAN', code: 'SIFC', label: 'Sífilis congênita', coverage: 'BR' },
  { system: 'SINAN', code: 'SIFG', label: 'Sífilis em gestante', coverage: 'BR' },
  { system: 'SINAN', code: 'SRC', label: 'Síndrome da rubéola congênita', coverage: 'BR' },
  { system: 'SINAN', code: 'TETA', label: 'Tétano acidental', coverage: 'BR' },
  { system: 'SINAN', code: 'TETN', label: 'Tétano neonatal', coverage: 'BR' },
  { system: 'SINAN', code: 'TOXC', label: 'Toxoplasmose congênita', coverage: 'BR' },
  { system: 'SINAN', code: 'TOXG', label: 'Toxoplasmose gestacional', coverage: 'BR' },
  { system: 'SINAN', code: 'TRAC', label: 'Inquérito de tracoma', coverage: 'BR' },
  { system: 'SINAN', code: 'TUBE', label: 'Tuberculose', coverage: 'BR' },
  { system: 'SINAN', code: 'VARC', label: 'Varicela', coverage: 'BR' },
  { system: 'SINAN', code: 'VIOL', label: 'Violência doméstica, sexual e outras violências', coverage: 'BR' },
  { system: 'SINAN', code: 'ZIKA', label: 'Zika vírus', coverage: 'BR' },
  { system: 'CIHA', code: 'CIHA', label: 'Comunicação hospitalar e ambulatorial', coverage: 'UF' },
  { system: 'CIH', code: 'CR', label: 'Comunicação de internação hospitalar', coverage: 'UF' },
  { system: 'SISCOLO', code: 'CC', label: 'Citopatológico do colo do útero', coverage: 'UF' },
  { system: 'SISCOLO', code: 'HC', label: 'Histopatológico do colo do útero', coverage: 'UF' },
  { system: 'SISMAMA', code: 'CM', label: 'Citopatológico de mama', coverage: 'UF' },
  { system: 'SISMAMA', code: 'HM', label: 'Histopatológico de mama', coverage: 'UF' },
  { system: 'SISPRENATAL', code: 'PN', label: 'Pré-natal', coverage: 'UF' },
  { system: 'ESUSNOTIFICA', code: 'DCCR', label: 'Doença de Chagas crônica', coverage: 'BR' },
  { system: 'RESP', code: 'RESP', label: 'Casos suspeitos de síndrome congênita', coverage: 'UF' },
  { system: 'PO', code: 'PO', label: 'Painel de Oncologia', coverage: 'BR' },
  { system: 'PCE', code: 'PCE', label: 'Controle da esquistossomose', coverage: 'BOTH' },
  { system: 'IBGE', code: 'POP', label: 'Censo e estimativas populacionais', coverage: 'BR' },
  { system: 'IBGE', code: 'POPS', label: 'Estimativas por sexo e idade', coverage: 'BR' },
  { system: 'IBGE', code: 'POPT', label: 'Estimativas TCU', coverage: 'BR' },
] as const;

const OFFICIAL_FTP_HOST = 'ftp.datasus.gov.br';
const OFFICIAL_HTTPS_HOST = 'datasus.saude.gov.br';

function appendArray(params: URLSearchParams, key: string, values: readonly string[]): void {
  for (const value of values) params.append(`${key}[]`, value);
}

export function buildSearchBody(query: DatasusSearchQuery): URLSearchParams {
  const body = new URLSearchParams();
  appendArray(body, 'tipo_arquivo', [query.fileType]);
  appendArray(body, 'modalidade', ['1']);
  appendArray(body, 'fonte', [query.system]);
  appendArray(body, 'ano', [query.year]);
  if (query.month) appendArray(body, 'mes', [query.month]);
  if (query.uf) appendArray(body, 'uf', [query.uf]);
  return body;
}

function orderedUnique(values: readonly string[] | undefined): string[] {
  return [...new Set((values ?? []).map((value) => value.trim()).filter(Boolean))]
    .sort((left, right) => left.localeCompare(right));
}

/** Produces a stable request list for the official single-tuple catalog API. */
export function expandDatasusSearchSelection(selection: DatasusSearchSelection): DatasusSearchQuery[] {
  const years = orderedUnique(selection.years);
  if (!years.length) throw new Error('Selecione pelo menos um ano do DATASUS');
  const months = selection.annual ? [''] : orderedUnique(selection.months);
  if (!selection.annual && !months.length) throw new Error('Selecione pelo menos um mês do DATASUS');
  const ufs = orderedUnique(selection.ufs);
  const queries: DatasusSearchQuery[] = [];
  for (const year of years) for (const month of months) {
    if (ufs.length) for (const uf of ufs) {
      queries.push({
        system: selection.system,
        fileType: selection.fileType,
        year,
        ...(month ? { month } : {}),
        // The official catalog represents national coverage by omitting UF.
        // `BR` is only the explicit multi-select UI sentinel.
        ...(uf === 'BR' ? {} : { uf }),
      });
    } else queries.push({ system: selection.system, fileType: selection.fileType, year, ...(month ? { month } : {}) });
  }
  return queries;
}

/** Removes overlapping catalog entries while imposing an auditable stable order. */
export function deduplicateRemoteFiles(files: readonly DatasusRemoteFile[]): DatasusRemoteFile[] {
  const unique = new Map<string, DatasusRemoteFile>();
  for (const file of files) {
    const key = `${file.address}\n${file.name}`;
    if (!unique.has(key)) unique.set(key, file);
  }
  return [...unique.values()].sort((left, right) =>
    left.address.localeCompare(right.address) || left.name.localeCompare(right.name));
}

export function buildAuxiliarySearchBody(system: string): URLSearchParams {
  const body = new URLSearchParams();
  appendArray(body, 'tipo_arquivo', ['AUX']);
  appendArray(body, 'modalidade', ['0']);
  appendArray(body, 'fonte', [system]);
  return body;
}

function isOfficialFtpAddress(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'ftp:' && url.hostname.toLowerCase() === OFFICIAL_FTP_HOST;
  } catch {
    return false;
  }
}

export function parseSearchResponse(payload: string): DatasusRemoteFile[] {
  const parsed: unknown = JSON.parse(payload);
  if (!Array.isArray(parsed)) throw new Error('Resposta inesperada do catálogo DATASUS');
  const files: DatasusRemoteFile[] = [];
  for (const item of parsed) {
    if (!item || typeof item !== 'object') continue;
    const record = item as Record<string, unknown>;
    const name = typeof record.arquivo === 'string' ? record.arquivo : '';
    const address = typeof record.endereco === 'string' ? record.endereco : '';
    if (!name || !isOfficialFtpAddress(address)) continue;
    files.push({
      source: typeof record.fonte === 'string' ? record.fonte : '',
      modality: typeof record.modalidade === 'string' ? record.modalidade : '',
      name,
      address,
    });
  }
  return files;
}

export function buildDownloadBody(files: readonly DatasusRemoteFile[]): URLSearchParams {
  if (!files.length) throw new Error('Selecione pelo menos um arquivo do DATASUS');
  const body = new URLSearchParams();
  files.forEach((file, index) => {
    if (!isOfficialFtpAddress(file.address)) throw new Error(`Endereço não oficial recusado: ${file.address}`);
    body.append(`dados[${index}][arquivo]`, file.name);
    body.append(`dados[${index}][link]`, file.address);
  });
  return body;
}

function collectStrings(value: unknown, output: string[]): void {
  if (typeof value === 'string') output.push(value);
  else if (Array.isArray(value)) for (const item of value) collectStrings(item, output);
}

export function parsePreparedDownloadResponse(payload: string): string {
  const parsed: unknown = JSON.parse(payload);
  const candidates: string[] = [];
  collectStrings(parsed, candidates);
  for (const candidate of candidates) {
    try {
      const url = new URL(candidate);
      if (url.protocol === 'https:' && url.hostname.toLowerCase() === OFFICIAL_HTTPS_HOST &&
          url.pathname.startsWith('/wp-content/zipupload/') && url.pathname.endsWith('/arquivo.zip')) {
        return url.href;
      }
    } catch {
      // Ignore malformed values and continue looking for the official URL.
    }
  }
  throw new Error('O DATASUS não retornou um download HTTPS válido');
}

export function fileTypesForSystem(system: string): DatasusFileType[] {
  return DATASUS_FILE_TYPES.filter((item) => item.system === system);
}

export function systemIsAnnual(system: string): boolean {
  return DATASUS_SYSTEMS.find((item) => item.code === system)?.annual ?? false;
}

/**
 * Navigable catalog metadata only. It describes how to query the official
 * catalog, never claims that an individual year/period is available.
 */
export function catalogCapabilities(systemCode: string, fileTypeCode: string): DatasusCatalogCapabilities {
  const system = DATASUS_SYSTEMS.find((item) => item.code === systemCode);
  if (!system) throw new Error(`Sistema DATASUS desconhecido: ${systemCode}`);
  const fileType = DATASUS_FILE_TYPES.find((item) => item.system === systemCode && item.code === fileTypeCode);
  if (!fileType) throw new Error(`Tipo DATASUS desconhecido para ${systemCode}: ${fileTypeCode}`);
  const geographies: Array<'BR' | 'UF'> = fileType.coverage === 'BOTH'
    ? ['BR', 'UF'] : fileType.coverage === 'BR' ? ['BR'] : ['UF'];
  return {
    system,
    fileType,
    periodicity: system.annual ? 'annual' : 'monthly',
    geographies,
    multiplePeriods: true,
    multipleUfs: geographies.includes('UF'),
    availability: 'verified-at-query-time',
    auxiliaryResolution: verifiedAuxiliaryBundleName(systemCode, fileTypeCode)
      ? 'verified-automatic' : 'explicit-manual',
  };
}

/** Builds an evidence-only availability view from actual official query results. */
export function buildAvailabilityManifest(results: readonly DatasusCatalogQueryResult[]): DatasusAvailabilityManifest {
  const entries = results.map(({ query, files }) => ({
    query: { ...query },
    status: files.length ? 'available' as const : 'missing' as const,
    files: files.map(({ name, address }) => ({ name, address })),
  }));
  return {
    requestedQueries: entries.length,
    availableQueries: entries.filter((entry) => entry.status === 'available').length,
    missingQueries: entries.filter((entry) => entry.status === 'missing').map((entry) => ({ ...entry.query })),
    fileCount: entries.reduce((count, entry) => count + entry.files.length, 0),
    entries,
  };
}

function stableJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableJsonValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, stableJsonValue(item)]));
  }
  return value;
}

function validateManifestQuery(value: unknown, system: string, fileType: string): DatasusSearchQuery {
  if (!value || typeof value !== 'object') throw new Error('Consulta inválida no manifesto de fontes');
  const query = value as Record<string, unknown>;
  if (query.system !== system || query.fileType !== fileType || typeof query.year !== 'string' || !query.year) {
    throw new Error('Consulta incompatível no manifesto de fontes');
  }
  if (query.month !== undefined && typeof query.month !== 'string') throw new Error('Mês inválido no manifesto de fontes');
  if (query.uf !== undefined && typeof query.uf !== 'string') throw new Error('UF inválida no manifesto de fontes');
  return { system, fileType, year: query.year, ...(query.month ? { month: query.month } : {}), ...(query.uf ? { uf: query.uf } : {}) };
}

export function parseSourceManifest(payload: string): DatasusSourceManifestV1 {
  const parsed: unknown = JSON.parse(payload);
  if (!parsed || typeof parsed !== 'object') throw new Error('Manifesto de fontes inválido');
  const record = parsed as Record<string, unknown>;
  if (record.schema !== 'tabwin-web.source-manifest' || record.version !== 1) throw new Error('Formato de manifesto de fontes não suportado');
  if (typeof record.system !== 'string' || typeof record.fileType !== 'string') throw new Error('Origem ausente no manifesto de fontes');
  catalogCapabilities(record.system, record.fileType);
  if (typeof record.createdAt !== 'string' || !Number.isFinite(Date.parse(record.createdAt))) throw new Error('Data inválida no manifesto de fontes');
  const availability = record.availability as Record<string, unknown> | undefined;
  if (!availability || !Array.isArray(availability.entries) || availability.entries.length > 10_000) throw new Error('Entradas inválidas no manifesto de fontes');
  const entries = availability.entries.map((value) => {
    if (!value || typeof value !== 'object') throw new Error('Entrada inválida no manifesto de fontes');
    const entry = value as Record<string, unknown>;
    const query = validateManifestQuery(entry.query, record.system as string, record.fileType as string);
    if (entry.status !== 'available' && entry.status !== 'missing') throw new Error('Status inválido no manifesto de fontes');
    const status: 'available' | 'missing' = entry.status;
    if (!Array.isArray(entry.files) || entry.files.length > 10_000) throw new Error('Arquivos inválidos no manifesto de fontes');
    const files = entry.files.map((value) => {
      if (!value || typeof value !== 'object') throw new Error('Arquivo inválido no manifesto de fontes');
      const file = value as Record<string, unknown>;
      if (typeof file.name !== 'string' || !file.name || typeof file.address !== 'string' || !isOfficialFtpAddress(file.address)) throw new Error('Endereço de arquivo não oficial no manifesto de fontes');
      return { name: file.name, address: file.address };
    });
    if ((status === 'available') !== (files.length > 0)) throw new Error('Status inconsistente no manifesto de fontes');
    return { query, status, files };
  });
  return {
    schema: 'tabwin-web.source-manifest', version: 1, createdAt: record.createdAt, system: record.system, fileType: record.fileType,
    availability: {
      requestedQueries: entries.length,
      availableQueries: entries.filter((entry) => entry.status === 'available').length,
      missingQueries: entries.filter((entry) => entry.status === 'missing').map((entry) => ({ ...entry.query })),
      fileCount: entries.reduce((count, entry) => count + entry.files.length, 0),
      entries,
    },
  };
}

/** Creates a portable provenance record without embedding downloaded health data. */
export function createSourceManifest(system: string, fileType: string, availability: DatasusAvailabilityManifest, createdAt = new Date().toISOString()): DatasusSourceManifestV1 {
  return parseSourceManifest(JSON.stringify({ schema: 'tabwin-web.source-manifest', version: 1, createdAt, system, fileType, availability }));
}

export function serializeSourceManifest(manifest: DatasusSourceManifestV1): string {
  const validated = parseSourceManifest(JSON.stringify(manifest));
  return `${JSON.stringify(stableJsonValue(validated), null, 2)}\n`;
}

function manifestQueryKey(query: DatasusSearchQuery): string {
  return [query.system, query.fileType, query.year, query.month ?? '', query.uf ?? ''].join('\n');
}

function manifestFiles(manifest: DatasusSourceManifestV1): Map<string, Pick<DatasusRemoteFile, 'name' | 'address'>> {
  const files = new Map<string, Pick<DatasusRemoteFile, 'name' | 'address'>>();
  for (const entry of manifest.availability.entries) for (const file of entry.files) files.set(`${file.address}\n${file.name}`, file);
  return files;
}

/** Compares observed catalog evidence; it never infers why an official result changed. */
export function compareSourceManifests(previousInput: DatasusSourceManifestV1, currentInput: DatasusSourceManifestV1): DatasusSourceManifestDiff {
  const previous = parseSourceManifest(JSON.stringify(previousInput));
  const current = parseSourceManifest(JSON.stringify(currentInput));
  if (previous.system !== current.system || previous.fileType !== current.fileType) {
    throw new Error('Manifestos de sistemas ou tipos diferentes não podem ser comparados');
  }
  const previousFiles = manifestFiles(previous);
  const currentFiles = manifestFiles(current);
  const sortFiles = (files: Array<Pick<DatasusRemoteFile, 'name' | 'address'>>) => files.sort((left, right) => left.address.localeCompare(right.address) || left.name.localeCompare(right.name));
  const previousStatus = new Map(previous.availability.entries.map((entry) => [manifestQueryKey(entry.query), entry]));
  return {
    addedFiles: sortFiles([...currentFiles].filter(([key]) => !previousFiles.has(key)).map(([, file]) => ({ ...file }))),
    removedFiles: sortFiles([...previousFiles].filter(([key]) => !currentFiles.has(key)).map(([, file]) => ({ ...file }))),
    unchangedFiles: sortFiles([...currentFiles].filter(([key]) => previousFiles.has(key)).map(([, file]) => ({ ...file }))),
    newlyAvailableQueries: current.availability.entries.filter((entry) => entry.status === 'available' && previousStatus.get(manifestQueryKey(entry.query))?.status === 'missing').map((entry) => ({ ...entry.query })),
    newlyMissingQueries: current.availability.entries.filter((entry) => entry.status === 'missing' && previousStatus.get(manifestQueryKey(entry.query))?.status === 'available').map((entry) => ({ ...entry.query })),
  };
}

/**
 * Auxiliary archive relationship verified against a real official SIH-RD
 * acquisition. This is intentionally not a system-wide naming convention.
 */
export function verifiedAuxiliaryBundleName(system: string, fileType: string): string | null {
  return system === 'SIHSUS' && fileType === 'RD' ? 'TAB_SIH.zip' : null;
}
