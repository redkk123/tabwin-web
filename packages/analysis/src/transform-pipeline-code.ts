/**
 * Renders a {@link TransformPipeline}'s steps as equivalent R (dplyr) or
 * Python (pandas) code - a pedagogical, read-only view, never something that
 * runs. The point (from the 2026-08-30 conversation about the Wanderson
 * course) is that a beginner builds the pipeline through the interface and
 * gradually sees what each step would mean in R/Python.
 *
 * The plan is the source of truth. This code is derived from it and is
 * explicitly one-way: there is no parser back from text, and nothing here is
 * executed. A step whose exact semantics differ from the target's built-in
 * (the epidemiological week, the IBGE standardization) is rendered with a
 * comment saying so, rather than a call that would quietly compute something
 * else.
 */

import type { FilterSpec } from '../../core/src/model.js';
import type {
  SummaryAggregation,
  TextOperation,
  TransformStep,
} from './transform-pipeline.js';

export type PipelineCodeTarget = 'r' | 'python';

/** R string literal: double-quoted, backslash and quote escaped. */
function rString(value: string): string {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

/** Python string literal, same escaping. */
function pyString(value: string): string {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

function rVector(values: readonly string[]): string {
  return `c(${values.map(rString).join(', ')})`;
}

function pyList(values: readonly string[]): string {
  return `[${values.map(pyString).join(', ')}]`;
}

/** A dplyr filter predicate for one FilterSpec, already accounting for its mode. */
function filterPredicateR(filter: FilterSpec): string {
  const field = filter.field;
  if (filter.kind === 'numeric-range') {
    const parts: string[] = [];
    if (filter.minimum !== undefined) parts.push(`${field} ${filter.includeMinimum === false ? '>' : '>='} ${filter.minimum}`);
    if (filter.maximum !== undefined) parts.push(`${field} ${filter.includeMaximum === false ? '<' : '<='} ${filter.maximum}`);
    const predicate = parts.join(' & ') || 'TRUE';
    return filter.mode === 'exclude' ? `!(${predicate})` : predicate;
  }
  const test = `${field} %in% ${rVector(filter.acceptedCategories.map(String))}`;
  return filter.mode === 'exclude' ? `!(${test})` : test;
}

function filterPredicatePython(filter: FilterSpec): string {
  const field = `df[${pyString(filter.field)}]`;
  if (filter.kind === 'numeric-range') {
    const parts: string[] = [];
    if (filter.minimum !== undefined) parts.push(`(${field} ${filter.includeMinimum === false ? '>' : '>='} ${filter.minimum})`);
    if (filter.maximum !== undefined) parts.push(`(${field} ${filter.includeMaximum === false ? '<' : '<='} ${filter.maximum})`);
    const predicate = parts.join(' & ') || 'True';
    return filter.mode === 'exclude' ? `~(${predicate})` : predicate;
  }
  const test = `${field}.isin(${pyList(filter.acceptedCategories.map(String))})`;
  return filter.mode === 'exclude' ? `~${test}` : test;
}

/** A TabWin formula with column names left bare (`[Óbitos]` -> `Óbitos`), for R. */
function formulaToBareColumns(formula: string): string {
  return formula.replace(/^=/, '').replace(/\[([^\]]+)\]/g, '$1').replace(/\s*;\s*/g, ', ');
}

/** A TabWin formula with columns as pandas indexing (`[Óbitos]` -> `df["Óbitos"]`). */
function formulaToDataFrameColumns(formula: string): string {
  return formula.replace(/^=/, '').replace(/\[([^\]]+)\]/g, (_, name) => `df[${pyString(String(name))}]`).replace(/\s*;\s*/g, ', ');
}

function aggregationR(aggregation: SummaryAggregation): string {
  switch (aggregation.kind) {
    case 'count': return `${aggregation.as} = dplyr::n()`;
    case 'sum': return `${aggregation.as} = sum(${aggregation.field}, na.rm = TRUE)`;
    case 'mean': return `${aggregation.as} = mean(${aggregation.field}, na.rm = TRUE)`;
    case 'median': return `${aggregation.as} = median(${aggregation.field}, na.rm = TRUE)`;
    case 'min': return `${aggregation.as} = min(${aggregation.field}, na.rm = TRUE)`;
    case 'max': return `${aggregation.as} = max(${aggregation.field}, na.rm = TRUE)`;
    case 'distinct': return `${aggregation.as} = dplyr::n_distinct(${aggregation.field})`;
  }
}

function aggregationPython(aggregation: SummaryAggregation): string {
  const named = (call: string): string => `${aggregation.as}=${call}`;
  switch (aggregation.kind) {
    case 'count': return named('("__count__", "size")');
    case 'sum': return named(`(${pyString(aggregation.field)}, "sum")`);
    case 'mean': return named(`(${pyString(aggregation.field)}, "mean")`);
    case 'median': return named(`(${pyString(aggregation.field)}, "median")`);
    case 'min': return named(`(${pyString(aggregation.field)}, "min")`);
    case 'max': return named(`(${pyString(aggregation.field)}, "max")`);
    case 'distinct': return named(`(${pyString(aggregation.field)}, "nunique")`);
  }
}

function textOperationR(field: string, operation: TextOperation): string {
  switch (operation.kind) {
    case 'trim': return `${field} = trimws(${field})`;
    case 'upper': return `${field} = toupper(${field})`;
    case 'lower': return `${field} = tolower(${field})`;
    case 'pad-start': return `${field} = formatC(${field}, width = ${operation.length}, flag = ${rString(operation.fill === '0' ? '0' : '-')})`;
    case 'substring': return operation.length === undefined
      ? `${field} = substring(${field}, ${operation.start})`
      : `${field} = substring(${field}, ${operation.start}, ${operation.start + operation.length - 1})`;
    case 'ibge-municipality': return `${field} = substr(sprintf("%06s", ${field}), 1, 6)`;
  }
}

function textOperationPython(field: string, operation: TextOperation): string {
  const col = `df[${pyString(field)}]`;
  switch (operation.kind) {
    case 'trim': return `${col} = ${col}.str.strip()`;
    case 'upper': return `${col} = ${col}.str.upper()`;
    case 'lower': return `${col} = ${col}.str.lower()`;
    case 'pad-start': return `${col} = ${col}.str.pad(${operation.length}, side="left", fillchar=${pyString(operation.fill)})`;
    case 'substring': return operation.length === undefined
      ? `${col} = ${col}.str.slice(${operation.start - 1})`
      : `${col} = ${col}.str.slice(${operation.start - 1}, ${operation.start - 1 + operation.length})`;
    case 'ibge-municipality': return `${col} = ${col}.astype(str).str.zfill(6).str[:6]  # padroniza IBGE (6 dígitos); a lógica exata do TabWin Web trata 5/6/7 dígitos`;
  }
}

const DATE_PART_R: Record<string, string> = {
  year: 'lubridate::year',
  month: 'lubridate::month',
  day: 'lubridate::day',
  quarter: 'lubridate::quarter',
};
const DATE_PART_PY: Record<string, string> = {
  year: 'dt.year',
  month: 'dt.month',
  day: 'dt.day',
  quarter: 'dt.quarter',
};

/**
 * A rendered dplyr verb, plus optional notes shown on their own lines. Notes
 * are separated out because the R native pipe cannot carry an inline comment
 * on a line that also needs a trailing `|>` - the comment would swallow the
 * pipe. Emitting notes as standalone comment lines (which the pipe treats as
 * whitespace) keeps the chain valid.
 */
interface RVerb {
  code: string;
  notes?: string[];
}

function stepToR(step: TransformStep): RVerb[] {
  switch (step.kind) {
    case 'select-columns': {
      const parts = step.keepFields.map((field) => {
        const renamed = step.renameFields?.[field];
        return renamed ? `${renamed} = ${field}` : field;
      });
      return [{ code: `dplyr::select(${parts.join(', ')})` }];
    }
    case 'filter-rows': {
      const predicate = step.filters.map(filterPredicateR).join(' & ') || 'TRUE';
      const notes = (step.crossFieldRules ?? []).length
        ? ['regras cruzadas: cada uma exclui/sinaliza a combinação de todos os seus campos']
        : undefined;
      return [{ code: `dplyr::filter(${predicate})`, ...(notes ? { notes } : {}) }];
    }
    case 'recode': {
      const cases = step.mapping.map((entry) => `${entry.from.map((raw) => rString(raw)).join(', ')} ~ ${rString(entry.to)}`);
      const other = step.otherwise.policy === 'keep' ? `.default = ${step.field}`
        : step.otherwise.policy === 'missing' ? '.default = NA'
        : `.default = ${rString(step.otherwise.label)}`;
      return [{ code: `dplyr::mutate(${step.field} = dplyr::case_match(as.character(${step.field}), ${[...cases, other].join(', ')}))` }];
    }
    case 'missing-value-policy':
      return [{ code: `dplyr::mutate(${step.field} = dplyr::na_if(as.character(${step.field}), ${step.sentinelValues.map(rString).join(') |> dplyr::na_if(')}))` }];
    case 'dedupe':
      return [{ code: `dplyr::distinct(${step.keyFields.join(', ')}, .keep_all = TRUE)` }];
    case 'derive-column':
      return [{
        code: `dplyr::mutate(${step.field} = ${formulaToBareColumns(step.formula)})`,
        notes: ['fórmula do TabWin Web (funções como RATE/ZSCORE/LAG não têm equivalente direto em R)'],
      }];
    case 'cast-type': {
      const fn = step.to === 'number' ? 'as.numeric' : step.to === 'date' ? 'as.Date' : 'as.character';
      return [{ code: `dplyr::mutate(${step.field} = ${fn}(${step.field}))` }];
    }
    case 'date-part': {
      if (step.part === 'epidemiological-week' || step.part === 'epidemiological-year') {
        return [{
          code: `dplyr::mutate(${step.target} = aweek::date2week(as.Date(${step.field}), ${step.part === 'epidemiological-week' ? 'floor_day = TRUE' : 'week_start = "Sunday"'}))`,
          notes: ['semana/ano epidemiológico (regra MMWR/MS); a lógica exata do TabWin Web pode diferir de aweek nas bordas de ano'],
        }];
      }
      return [{ code: `dplyr::mutate(${step.target} = ${DATE_PART_R[step.part]}(as.Date(${step.field})))` }];
    }
    case 'text-normalize': {
      const usesIbge = step.operations.some((operation) => operation.kind === 'ibge-municipality');
      return [{
        code: `dplyr::mutate(${step.operations.map((operation) => textOperationR(step.field, operation)).join(', ')})`,
        ...(usesIbge ? { notes: ['padronização IBGE: a lógica exata do TabWin Web trata 5/6/7 dígitos'] } : {}),
      }];
    }
    case 'group-summarize':
      return [
        { code: `dplyr::group_by(${step.groupFields.join(', ')})` },
        { code: `dplyr::summarise(${step.aggregations.map(aggregationR).join(', ')}, .groups = "drop")` },
      ];
    case 'bind-rows':
      return [{
        code: `dplyr::bind_rows(${rString(step.source.label)} = .x)`,
        notes: [
          `empilha a segunda base (${step.source.label}); colunas só de um lado ficam NA`,
          ...(step.originField ? [`coluna de origem: ${step.originField}`] : []),
        ],
      }];
    case 'join': {
      const fn = { inner: 'inner_join', left: 'left_join', right: 'right_join', full: 'full_join' }[step.joinType];
      const by = step.keyPairs.map((pair) => `${rString(pair.current)} = ${rString(pair.source)}`).join(', ');
      return [{
        code: `dplyr::${fn}(${step.source.label.replace(/[^a-zA-Z0-9_]/g, '_')}, by = c(${by}))`,
        notes: [`junta a base ${step.source.label} pela chave; diagnóstico de cardinalidade fica no TabWin Web`],
      }];
    }
  }
}

/** One step rendered as pandas statements over `df`. */
function stepToPython(step: TransformStep): string[] {
  const prefix = step.enabled === false ? '# (etapa desativada) ' : '';
  const line = (text: string): string => `${prefix}${text}`;
  switch (step.kind) {
    case 'select-columns': {
      const lines = [line(`df = df[${pyList(step.keepFields)}]`)];
      const renames = Object.entries(step.renameFields ?? {});
      if (renames.length) {
        const mapping = renames.map(([from, to]) => `${pyString(from)}: ${pyString(to)}`).join(', ');
        lines.push(line(`df = df.rename(columns={${mapping}})`));
      }
      return lines;
    }
    case 'filter-rows': {
      const predicate = step.filters.map(filterPredicatePython).map((part) => `(${part})`).join(' & ') || 'True';
      const lines = [line(`df = df[${predicate}]`)];
      if ((step.crossFieldRules ?? []).length) {
        lines.push('# regras cruzadas: cada uma exclui/sinaliza a combinação de todos os seus campos');
      }
      return lines;
    }
    case 'recode': {
      const mapping = step.mapping.flatMap((entry) => entry.from.map((raw) => `${pyString(raw)}: ${pyString(entry.to)}`)).join(', ');
      const col = `df[${pyString(step.field)}]`;
      const mapped = `${col}.astype(str).map({${mapping}})`;
      const filled = step.otherwise.policy === 'keep' ? `.fillna(${col})`
        : step.otherwise.policy === 'category' ? `.fillna(${pyString(step.otherwise.label)})`
        : '';
      return [line(`${col} = ${mapped}${filled}`)];
    }
    case 'missing-value-policy':
      return [line(`df[${pyString(step.field)}] = df[${pyString(step.field)}].astype(str).replace(${pyList(step.sentinelValues)}, None)`)];
    case 'dedupe':
      return [line(`df = df.drop_duplicates(subset=${pyList(step.keyFields)}, keep="first")`)];
    case 'derive-column':
      return [line(`df[${pyString(step.field)}] = ${formulaToDataFrameColumns(step.formula)}  # fórmula do TabWin Web (RATE/ZSCORE/LAG não têm equivalente direto em pandas)`)];
    case 'cast-type': {
      const col = `df[${pyString(step.field)}]`;
      const cast = step.to === 'number' ? `pd.to_numeric(${col}, errors="coerce")`
        : step.to === 'date' ? `pd.to_datetime(${col}, errors="coerce")`
        : `${col}.astype(str)`;
      return [line(`${col} = ${cast}`)];
    }
    case 'date-part': {
      const col = `df[${pyString(step.field)}]`;
      if (step.part === 'epidemiological-week' || step.part === 'epidemiological-year') {
        return [line(`df[${pyString(step.target)}] = None  # semana/ano epidemiológico (regra MMWR/MS) - a lógica exata está no TabWin Web`)];
      }
      return [line(`df[${pyString(step.target)}] = pd.to_datetime(${col}).${DATE_PART_PY[step.part]}`)];
    }
    case 'text-normalize':
      return step.operations.map((operation) => line(textOperationPython(step.field, operation)));
    case 'group-summarize': {
      const named = step.aggregations.map((aggregation) => {
        if (aggregation.kind === 'count') return `${aggregation.as}=("${step.groupFields[0]}", "size")`;
        return aggregationPython(aggregation);
      }).join(', ');
      return [line(`df = df.groupby(${pyList(step.groupFields)}, as_index=False).agg(${named})`)];
    }
    case 'bind-rows': {
      const lines = [
        `# empilha a segunda base (${step.source.label}); colunas só de um lado ficam NaN`,
        line(`df = pd.concat([df, ${step.source.label.replace(/[^a-zA-Z0-9_]/g, '_')}], ignore_index=True)`),
      ];
      if (step.originField) lines.splice(1, 0, `# coluna de origem: ${step.originField}`);
      return lines;
    }
    case 'join': {
      const how = step.joinType === 'inner' ? 'inner' : step.joinType === 'left' ? 'left' : step.joinType === 'right' ? 'right' : 'outer';
      const leftKeys = pyList(step.keyPairs.map((pair) => pair.current));
      const rightKeys = pyList(step.keyPairs.map((pair) => pair.source));
      return [
        `# diagnóstico de cardinalidade (N:N bloqueado) fica no TabWin Web`,
        line(`df = df.merge(${step.source.label.replace(/[^a-zA-Z0-9_]/g, '_')}, how="${how}", left_on=${leftKeys}, right_on=${rightKeys})`),
      ];
    }
  }
}

/**
 * The whole pipeline as one code block. `datasetName` is the variable the
 * code starts from. Disabled steps are shown, commented, so the reader sees
 * the full intended sequence.
 */
export function transformPipelineToCode(
  steps: readonly TransformStep[],
  target: PipelineCodeTarget,
  datasetName = 'dados',
): string {
  if (target === 'r') {
    if (!steps.length) return `${datasetName}`;
    // Flatten to verbs, tagging each with whether its step was disabled, so a
    // disabled step is shown fully commented rather than silently dropped.
    const verbs = steps.flatMap((step) => stepToR(step).map((verb) => ({ ...verb, disabled: step.enabled === false })));
    // The trailing pipe must land on the last *enabled* verb, so a disabled
    // final step (or an all-disabled pipeline) never leaves a dangling `|>`.
    let lastEnabled = -1;
    verbs.forEach((verb, index) => { if (!verb.disabled) lastEnabled = index; });
    const lines: string[] = [];
    verbs.forEach((verb, index) => {
      for (const note of verb.notes ?? []) lines.push(`  # ${note}`);
      const body = verb.disabled ? `# ${verb.code}` : verb.code;
      lines.push(`  ${body}${index < lastEnabled ? ' |>' : ''}`);
    });
    return [
      'library(dplyr)',
      '',
      // With no enabled step there is nothing to pipe into; show the source alone.
      lastEnabled === -1 ? `${datasetName} <- ${datasetName}` : `${datasetName} <- ${datasetName} |>`,
      ...lines,
    ].join('\n');
  }
  if (!steps.length) return 'df = dados.copy()';
  return [
    'import pandas as pd',
    '',
    'df = dados.copy()',
    ...steps.flatMap(stepToPython),
  ].join('\n');
}
