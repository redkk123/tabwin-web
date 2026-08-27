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
  { system: 'SINAN', code: 'DENG', label: 'Dengue', coverage: 'BR' },
  { system: 'SINAN', code: 'CHIK', label: 'Febre de Chikungunya', coverage: 'BR' },
  { system: 'SINAN', code: 'ZIKA', label: 'Zika vírus', coverage: 'BR' },
  { system: 'SINAN', code: 'TUBE', label: 'Tuberculose', coverage: 'BR' },
  { system: 'SINAN', code: 'HANS', label: 'Hanseníase', coverage: 'BR' },
  { system: 'SINAN', code: 'HEPA', label: 'Hepatites virais', coverage: 'BR' },
  { system: 'SINAN', code: 'IEXO', label: 'Intoxicação exógena', coverage: 'BR' },
  { system: 'SINAN', code: 'VIOL', label: 'Violências', coverage: 'BR' },
  { system: 'SINAN', code: 'ANIM', label: 'Acidentes por animais peçonhentos', coverage: 'BR' },
  { system: 'SINAN', code: 'MENI', label: 'Meningite', coverage: 'BR' },
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

