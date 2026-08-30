import {
  catalogCapabilities,
  expandDatasusSearchSelection,
  type DatasusSearchQuery,
} from './datasus.js';

export interface ResearchDatasetRequest {
  system: string;
  fileType: string;
  years: string[];
  months?: string[];
  ufs: string[];
}

export interface ResearchRequestV1 {
  schema: 'tabwin-web.research-request';
  version: 1;
  title?: string;
  datasets: ResearchDatasetRequest[];
  desiredFields: string[];
  /** User-authored terms only; this layer does not map them to dataset semantics. */
  conceptTerms?: string[];
}

export interface ResearchPlanV1 {
  schema: 'tabwin-web.research-plan';
  version: 1;
  request: ResearchRequestV1;
  datasets: Array<{
    system: string;
    fileType: string;
    queries: DatasusSearchQuery[];
  }>;
  estimate: {
    queryCount: number;
    fileCount: null;
    bytes: null;
    basis: 'catalog-query-count-only';
  };
}

function orderedUnique(values: unknown, label: string, allowEmpty = false): string[] {
  if (!Array.isArray(values) || values.some((item) => typeof item !== 'string')) throw new Error(`${label} inválido(s) no pedido de pesquisa`);
  const normalized = [...new Set(values.map((item) => item.trim()).filter(Boolean))].sort((left, right) => left.localeCompare(right));
  if (!allowEmpty && !normalized.length) throw new Error(`Selecione pelo menos um ${label.toLowerCase()}`);
  return normalized;
}

function stableJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableJsonValue);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right)).map(([key, item]) => [key, stableJsonValue(item)]));
  return value;
}

export function parseResearchRequest(payload: string): ResearchRequestV1 {
  const parsed: unknown = JSON.parse(payload);
  if (!parsed || typeof parsed !== 'object') throw new Error('Pedido de pesquisa inválido');
  const record = parsed as Record<string, unknown>;
  if (record.schema !== 'tabwin-web.research-request' || record.version !== 1) throw new Error('Formato de pedido de pesquisa não suportado');
  if (!Array.isArray(record.datasets) || !record.datasets.length || record.datasets.length > 50) throw new Error('Datasets inválidos no pedido de pesquisa');
  const seen = new Set<string>();
  const datasets = record.datasets.map((value) => {
    if (!value || typeof value !== 'object') throw new Error('Dataset inválido no pedido de pesquisa');
    const dataset = value as Record<string, unknown>;
    if (typeof dataset.system !== 'string' || typeof dataset.fileType !== 'string') throw new Error('Sistema/tipo ausente no pedido de pesquisa');
    const capabilities = catalogCapabilities(dataset.system, dataset.fileType);
    const key = `${dataset.system}\n${dataset.fileType}`;
    if (seen.has(key)) throw new Error('Dataset duplicado no pedido de pesquisa');
    seen.add(key);
    const years = orderedUnique(dataset.years, 'Ano');
    const months = capabilities.periodicity === 'monthly' ? orderedUnique(dataset.months, 'Mês') : [];
    const ufs = orderedUnique(dataset.ufs, 'Abrangência');
    for (const uf of ufs) {
      if (uf === 'BR' ? !capabilities.geographies.includes('BR') : !/^[A-Z]{2}$/.test(uf) || !capabilities.geographies.includes('UF')) {
        throw new Error(`Abrangência ${uf} incompatível com ${dataset.system}/${dataset.fileType}`);
      }
    }
    return { system: dataset.system, fileType: dataset.fileType, years, ...(months.length ? { months } : {}), ufs };
  });
  if (record.title !== undefined && typeof record.title !== 'string') throw new Error('Título inválido no pedido de pesquisa');
  return {
    schema: 'tabwin-web.research-request',
    version: 1,
    ...(typeof record.title === 'string' && record.title.trim() ? { title: record.title.trim() } : {}),
    datasets,
    desiredFields: orderedUnique(record.desiredFields, 'Campo desejado', true),
    ...(record.conceptTerms === undefined ? {} : { conceptTerms: orderedUnique(record.conceptTerms, 'Termo de conceito', true) }),
  };
}

export function createResearchPlan(requestInput: ResearchRequestV1): ResearchPlanV1 {
  const request = parseResearchRequest(JSON.stringify(requestInput));
  const datasets = request.datasets.map((dataset) => {
    const periodicity = catalogCapabilities(dataset.system, dataset.fileType).periodicity;
    return {
      system: dataset.system,
      fileType: dataset.fileType,
      queries: expandDatasusSearchSelection({
        system: dataset.system,
        fileType: dataset.fileType,
        years: dataset.years,
        ...(periodicity === 'annual' ? { annual: true } : { months: dataset.months ?? [] }),
        ufs: dataset.ufs,
      }),
    };
  });
  const queryCount = datasets.reduce((count, dataset) => count + dataset.queries.length, 0);
  if (queryCount > 10_000) throw new Error('Plano de pesquisa excede 10.000 consultas oficiais');
  return {
    schema: 'tabwin-web.research-plan', version: 1, request, datasets,
    estimate: { queryCount, fileCount: null, bytes: null, basis: 'catalog-query-count-only' },
  };
}

export function serializeResearchPlan(plan: ResearchPlanV1): string {
  const validated = createResearchPlan(plan.request);
  return `${JSON.stringify(stableJsonValue(validated), null, 2)}\n`;
}
