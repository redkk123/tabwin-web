import type { TabulationResult } from '../../../packages/core/src/model.ts';
import {
  arrowDataFromResult,
  chartDataFromResult,
  resolveAxis,
  scatterDataFromResult,
  seriesFromResult,
  type ChartDatum,
  type ChartSeries,
  type ChartType,
  type ScatterDatum,
} from '../../../packages/visualization/src/chart-model.ts';

const SVG_NS = 'http://www.w3.org/2000/svg';
const palette = ['#178b71', '#f16f5f', '#e1a83a', '#386fa4', '#8656a7', '#43a6a0', '#b75d69', '#77933c'];

/** Bottom of the plot area. Everything below it is ticks, axis title and legend. */
const PLOT_BOTTOM = 425;

export type ChartFontFamily = 'system' | 'serif' | 'monospace';
export type ChartSeriesMode = 'total' | 'columns';

export interface ChartRenderOptions {
  /** Visible title; accessibility title remains a separate required argument. */
  title?: string;
  subtitle?: string;
  fontFamily?: ChartFontFamily;
  primaryColor?: string;
  accentColor?: string;
  backgroundColor?: string;
  /** Undefined means "whatever this chart family did before the editor existed". */
  showLegend?: boolean | undefined;
  showValueLabels?: boolean | undefined;
  /** Undefined means automatic: integers stay integers, money keeps its cents. */
  decimalPlaces?: number | undefined;
  /** Explicit scatter/bubble presentation bindings. Both are required to activate XY mode. */
  xColumnKey?: string;
  yColumnKey?: string;
  /** Bubble radius binding. Only read in XY mode; without it the row total sizes the bubble. */
  sizeColumnKey?: string;
  /** Undefined means one series per column whenever the result has more than one. */
  seriesMode?: ChartSeriesMode | undefined;
  axisXLabel?: string;
  axisYLabel?: string;
  axisXMin?: number | undefined;
  axisXMax?: number | undefined;
  axisYMin?: number | undefined;
  axisYMax?: number | undefined;
  axisTickCount?: number | undefined;
  showGrid?: boolean | undefined;
}

interface ResolvedChartOptions {
  title: string;
  subtitle: string;
  fontFamily: ChartFontFamily;
  primaryColor: string;
  accentColor: string;
  backgroundColor: string;
  showLegend: boolean;
  showValueLabels: boolean;
  decimalPlaces: number | 'auto';
  xColumnKey?: string;
  yColumnKey?: string;
  sizeColumnKey?: string;
  seriesMode: ChartSeriesMode;
  axisXLabel: string;
  axisYLabel: string;
  axisXMin?: number | undefined;
  axisXMax?: number | undefined;
  axisYMin?: number | undefined;
  axisYMax?: number | undefined;
  axisTickCount: number;
  showGrid: boolean;
}

/**
 * What each family did before there was an editor. A control left untouched
 * must not silently change the chart: a pie without its legend is an unlabelled
 * disc, and horizontal bars without their values lose the only numbers on the
 * page. Anything the user actually toggles wins over this table.
 */
function familyDefaults(type: ChartType, multiSeries: boolean): { legend: boolean; labels: boolean } {
  if (type === 'pie') return { legend: true, labels: false };
  if (type === 'horizontal-bar' || type === 'arrows') return { legend: false, labels: true };
  return { legend: multiSeries, labels: false };
}

function resolveOptions(
  options: ChartRenderOptions,
  type: ChartType,
  result: TabulationResult,
): ResolvedChartOptions {
  const seriesMode = options.seriesMode ?? (result.columns.length > 1 ? 'columns' : 'total');
  const multiSeries = seriesMode === 'columns' && result.columns.length > 1;
  const defaults = familyDefaults(type, multiSeries);
  return {
    title: options.title?.trim() ?? '',
    subtitle: options.subtitle?.trim() ?? '',
    fontFamily: options.fontFamily ?? 'system',
    primaryColor: options.primaryColor ?? '#178b71',
    accentColor: options.accentColor ?? '#f16f5f',
    backgroundColor: options.backgroundColor ?? '#ffffff',
    showLegend: options.showLegend ?? defaults.legend,
    showValueLabels: options.showValueLabels ?? defaults.labels,
    decimalPlaces: options.decimalPlaces === undefined
      ? 'auto'
      : Math.min(6, Math.max(0, Math.round(options.decimalPlaces))),
    seriesMode,
    axisXLabel: options.axisXLabel?.trim() ?? '',
    axisYLabel: options.axisYLabel?.trim() ?? '',
    axisXMin: options.axisXMin,
    axisXMax: options.axisXMax,
    axisYMin: options.axisYMin,
    axisYMax: options.axisYMax,
    axisTickCount: Math.min(20, Math.max(2, Math.round(options.axisTickCount ?? 5))),
    showGrid: options.showGrid ?? true,
    ...(options.xColumnKey ? { xColumnKey: options.xColumnKey } : {}),
    ...(options.yColumnKey ? { yColumnKey: options.yColumnKey } : {}),
    ...(options.sizeColumnKey ? { sizeColumnKey: options.sizeColumnKey } : {}),
  };
}

function fontStack(font: ChartFontFamily): string {
  if (font === 'serif') return 'Georgia,"Times New Roman",serif';
  if (font === 'monospace') return '"DejaVu Sans Mono",Consolas,monospace';
  return 'Inter,ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif';
}

function node<K extends keyof SVGElementTagNameMap>(
  name: K,
  attributes: Record<string, string | number> = {},
  text?: string,
): SVGElementTagNameMap[K] {
  const element = document.createElementNS(SVG_NS, name);
  for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, String(value));
  if (text !== undefined) element.textContent = text;
  return element;
}

function shortLabel(value: string, max = 24): string {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

function valueText(value: number, options: ResolvedChartOptions): string {
  // 'auto' is what the chart did before the editor existed: counts print as
  // whole numbers, a currency sum keeps its cents, and nothing is padded with
  // zeros it never had.
  const digits = options.decimalPlaces === 'auto'
    ? { minimumFractionDigits: 0, maximumFractionDigits: 2 }
    : { minimumFractionDigits: options.decimalPlaces, maximumFractionDigits: options.decimalPlaces };
  return new Intl.NumberFormat('pt-BR', digits).format(value);
}

function seriesColor(index: number, options: ResolvedChartOptions): string {
  if (index === 0) return options.primaryColor;
  if (index === 1) return options.accentColor;
  return palette[index % palette.length] ?? options.primaryColor;
}

function rankedData(result: TabulationResult, limit = 18): ChartDatum[] {
  return chartDataFromResult(result, { limit, order: 'ranked' });
}

function titleOffset(options: ResolvedChartOptions): number {
  return options.title || options.subtitle ? 58 : 0;
}

function renderHeading(svg: SVGSVGElement, options: ResolvedChartOptions): void {
  if (options.title) svg.append(node('text', { x: 18, y: 28, class: 'chart-title' }, options.title));
  if (options.subtitle) svg.append(node('text', { x: 18, y: options.title ? 48 : 30, class: 'chart-subtitle' }, options.subtitle));
}

/** A legend row along the bottom. Returns false when there was nothing to name. */
function renderLegend(
  svg: SVGSVGElement,
  options: ResolvedChartOptions,
  entries: { label: string; color: string }[],
): boolean {
  if (!options.showLegend || !entries.length) return false;
  const shortened = entries.map((entry) => ({ ...entry, label: shortLabel(entry.label, 28) }));
  const widths = shortened.map((entry) => 20 + entry.label.length * 6.1 + 16);
  const total = widths.reduce((sum, width) => sum + width, 0);
  let x = Math.max(12, (1000 - total) / 2);
  shortened.forEach((entry, index) => {
    svg.append(node('rect', { x, y: 480, width: 12, height: 12, rx: 3, fill: entry.color }));
    svg.append(node('text', { x: x + 18, y: 490, class: 'chart-legend' }, entry.label));
    x += widths[index] ?? 0;
  });
  return true;
}

function renderSingleSeriesLegend(svg: SVGSVGElement, options: ResolvedChartOptions, label = 'Valor'): void {
  renderLegend(svg, options, [{ label, color: options.primaryColor }]);
}

function renderHorizontal(svg: SVGSVGElement, result: TabulationResult, options: ResolvedChartOptions): void {
  const data = rankedData(result, titleOffset(options) ? 14 : 16);
  const max = Math.max(...data.map((item) => item.value), 1);
  const offset = titleOffset(options);
  data.forEach((item, index) => {
    const y = 28 + offset + index * 29;
    svg.append(node('text', { x: 10, y: y + 16, class: 'chart-label' }, shortLabel(item.label, 28)));
    svg.append(node('rect', { x: 225, y, width: 650, height: 20, rx: 4, fill: '#edf3f1' }));
    svg.append(node('rect', { x: 225, y, width: Math.max(2, item.value / max * 650), height: 20, rx: 4, fill: options.primaryColor }));
    if (options.showValueLabels) {
      svg.append(node('text', { x: 980, y: y + 16, 'text-anchor': 'end', class: 'chart-value' }, valueText(item.value, options)));
    }
  });
  renderSingleSeriesLegend(svg, options);
}

interface PlotFrame {
  left: number;
  top: number;
  width: number;
  height: number;
}

function plotFrame(options: ResolvedChartOptions): PlotFrame {
  const left = options.axisYLabel ? 96 : 70;
  const top = 35 + titleOffset(options);
  return { left, top, width: 945 - left, height: PLOT_BOTTOM - top };
}

/** Y grid, Y ticks and both axis titles. Shared by the categorical and XY plots. */
function renderAxisFurniture(
  svg: SVGSVGElement,
  frame: PlotFrame,
  yTicks: number[],
  yFor: (value: number) => number,
  options: ResolvedChartOptions,
): void {
  for (const tick of yTicks) {
    const y = yFor(tick);
    if (y < frame.top - 0.5 || y > frame.top + frame.height + 0.5) continue;
    if (options.showGrid) {
      svg.append(node('line', { x1: frame.left, y1: y, x2: frame.left + frame.width, y2: y, class: 'chart-grid' }));
    }
    svg.append(node('text', { x: frame.left - 8, y: y + 4, 'text-anchor': 'end', class: 'chart-tick' }, valueText(tick, options)));
  }
  svg.append(node('line', { x1: frame.left, y1: frame.top, x2: frame.left, y2: frame.top + frame.height, class: 'chart-axis' }));
  svg.append(node('line', { x1: frame.left, y1: frame.top + frame.height, x2: frame.left + frame.width, y2: frame.top + frame.height, class: 'chart-axis' }));
  if (options.axisYLabel) {
    const midpoint = frame.top + frame.height / 2;
    svg.append(node('text', {
      x: 22, y: midpoint, 'text-anchor': 'middle', class: 'chart-axis-title',
      transform: `rotate(-90 22 ${midpoint})`,
    }, shortLabel(options.axisYLabel, 40)));
  }
  if (options.axisXLabel) {
    svg.append(node('text', {
      x: frame.left + frame.width / 2, y: 466, 'text-anchor': 'middle', class: 'chart-axis-title',
    }, shortLabel(options.axisXLabel, 60)));
  }
}

/** Fewer categories once every category has to fit several bars side by side. */
function plotData(result: TabulationResult, seriesCount: number): ChartDatum[] {
  const limit = seriesCount > 1 ? Math.max(6, Math.floor(48 / seriesCount)) : 24;
  return chartDataFromResult(result, { limit, order: 'source' });
}

function renderCartesian(
  svg: SVGSVGElement,
  result: TabulationResult,
  type: ChartType,
  options: ResolvedChartOptions,
): void {
  const multiSeries = options.seriesMode === 'columns' && result.columns.length > 1;
  const data = plotData(result, multiSeries ? result.columns.length : 1);
  const series: ChartSeries[] = multiSeries
    ? seriesFromResult(result, data)
    : [{ key: '__total__', label: 'Valor', values: data.map((item) => item.value) }];
  const frame = plotFrame(options);
  const { left, top, width, height } = frame;
  const everyValue = series.flatMap((entry) => entry.values);
  const axis = resolveAxis(
    Math.min(0, ...everyValue),
    Math.max(1, ...everyValue),
    { min: options.axisYMin, max: options.axisYMax, tickCount: options.axisTickCount },
  );
  const span = Math.max(1e-12, axis.max - axis.min);
  const xFor = (index: number) => left + (data.length <= 1 ? width / 2 : index / (data.length - 1) * width);
  const yFor = (value: number) => top + height - (value - axis.min) / span * height;
  const clamp = (y: number) => Math.min(top + height, Math.max(top, y));

  renderAxisFurniture(svg, frame, axis.ticks, yFor, options);

  if (type === 'vertical-bar') {
    const step = width / Math.max(1, data.length);
    const groupWidth = Math.max(4, step * .68);
    const barWidth = Math.max(2, groupWidth / series.length);
    const baseline = clamp(yFor(Math.max(axis.min, 0)));
    data.forEach((item, index) => {
      const groupX = left + index * step + (step - groupWidth) / 2;
      series.forEach((entry, seriesIndex) => {
        const value = entry.values[index] ?? 0;
        const x = groupX + seriesIndex * barWidth;
        const y = clamp(yFor(value));
        svg.append(node('rect', {
          x, y: Math.min(y, baseline), width: barWidth, height: Math.abs(baseline - y),
          rx: barWidth > 6 ? 3 : 0, fill: seriesColor(seriesIndex, options),
        }));
        if (options.showValueLabels && series.length === 1) {
          svg.append(node('text', {
            x: x + barWidth / 2, y: Math.max(top + 12, y - 5), 'text-anchor': 'middle', class: 'chart-value',
          }, valueText(value, options)));
        }
      });
    });
  } else {
    series.forEach((entry, seriesIndex) => {
      const color = seriesColor(seriesIndex, options);
      const points = entry.values.map((value, index) => `${xFor(index)},${clamp(yFor(value))}`).join(' ');
      if (type === 'area') {
        const baseline = clamp(yFor(Math.max(axis.min, 0)));
        svg.append(node('polygon', {
          points: `${left},${baseline} ${points} ${left + width},${baseline}`,
          fill: color, opacity: series.length > 1 ? .16 : .2,
        }));
      }
      if (type === 'line' || type === 'area') {
        svg.append(node('polyline', {
          points, fill: 'none', stroke: color,
          'stroke-width': series.length > 1 ? 3 : 4, 'stroke-linejoin': 'round',
        }));
      }
      const sizeMax = Math.max(...entry.values.map((value) => Math.abs(value)), 1);
      entry.values.forEach((value, index) => {
        const radius = type === 'bubbles' ? 5 + Math.sqrt(Math.max(0, value) / sizeMax) * 18 : 5;
        const cy = clamp(yFor(value));
        svg.append(node('circle', {
          cx: xFor(index), cy, r: radius,
          fill: type === 'points' && series.length === 1 ? options.accentColor : color,
          opacity: type === 'bubbles' ? .72 : 1,
        }));
        if (options.showValueLabels && series.length === 1) {
          svg.append(node('text', {
            x: xFor(index), y: Math.max(top + 12, cy - radius - 5), 'text-anchor': 'middle', class: 'chart-value',
          }, valueText(value, options)));
        }
      });
    });
  }
  data.forEach((item, index) => {
    if (index % Math.max(1, Math.ceil(data.length / 8)) !== 0) return;
    svg.append(node('text', { x: xFor(index), y: 445, 'text-anchor': 'middle', class: 'chart-tick' }, shortLabel(item.label, 12)));
  });
  renderLegend(svg, options, series.map((entry, index) => ({ label: entry.label, color: seriesColor(index, options) })));
}

function renderScatterBound(
  svg: SVGSVGElement,
  result: TabulationResult,
  type: 'points' | 'bubbles',
  options: ResolvedChartOptions,
): boolean {
  if (!options.xColumnKey || !options.yColumnKey) return false;
  const data = scatterDataFromResult(result, options.xColumnKey, options.yColumnKey, 100, options.sizeColumnKey);
  if (!data.length) return false;

  const frame = plotFrame(options);
  const { left, top, width, height } = frame;
  const xs = data.map((item) => item.x);
  const ys = data.map((item) => item.y);
  const xAxis = resolveAxis(Math.min(0, ...xs), Math.max(1, ...xs), {
    min: options.axisXMin, max: options.axisXMax, tickCount: options.axisTickCount,
  });
  const yAxis = resolveAxis(Math.min(0, ...ys), Math.max(1, ...ys), {
    min: options.axisYMin, max: options.axisYMax, tickCount: options.axisTickCount,
  });
  const xSpan = Math.max(1e-12, xAxis.max - xAxis.min);
  const ySpan = Math.max(1e-12, yAxis.max - yAxis.min);
  const sizeMax = Math.max(...data.map((item) => Math.max(0, item.size)), 1);
  const xFor = (value: number) => left + (value - xAxis.min) / xSpan * width;
  const yFor = (value: number) => top + height - (value - yAxis.min) / ySpan * height;
  const inside = (item: ScatterDatum) =>
    item.x >= xAxis.min && item.x <= xAxis.max && item.y >= yAxis.min && item.y <= yAxis.max;

  renderAxisFurniture(svg, frame, yAxis.ticks, yFor, options);
  for (const tick of xAxis.ticks) {
    const x = xFor(tick);
    if (x < left - 0.5 || x > left + width + 0.5) continue;
    if (options.showGrid) svg.append(node('line', { x1: x, y1: top, x2: x, y2: top + height, class: 'chart-grid' }));
    svg.append(node('text', { x, y: 445, 'text-anchor': 'middle', class: 'chart-tick' }, valueText(tick, options)));
  }
  // Manual bounds are a window, not a rescale: a point outside them is left out
  // rather than clamped onto the frame edge, where it would read as data.
  data.filter(inside).forEach((item: ScatterDatum) => {
    const radius = type === 'bubbles' ? 5 + Math.sqrt(Math.max(0, item.size) / sizeMax) * 16 : 5;
    svg.append(node('circle', {
      cx: xFor(item.x), cy: yFor(item.y), r: radius,
      fill: type === 'points' ? options.accentColor : options.primaryColor,
      opacity: type === 'bubbles' ? .72 : .9,
    }));
    if (options.showValueLabels) {
      svg.append(node('text', {
        x: xFor(item.x), y: yFor(item.y) - radius - 5,
        'text-anchor': 'middle', class: 'chart-value',
      }, shortLabel(item.label, 16)));
    }
  });
  const columnLabel = (key: string | undefined) => result.columns.find((column) => column.key === key)?.label ?? key ?? '';
  const entries = [
    { label: `X: ${columnLabel(options.xColumnKey)}`, color: options.accentColor },
    { label: `Y: ${columnLabel(options.yColumnKey)}`, color: options.primaryColor },
  ];
  if (type === 'bubbles') {
    const sizeLabel = options.sizeColumnKey ? columnLabel(options.sizeColumnKey) : 'total da linha';
    entries.push({ label: `Tamanho: ${sizeLabel}`, color: '#9db3ad' });
  }
  renderLegend(svg, options, entries);
  return true;
}

function polar(cx: number, cy: number, radius: number, angle: number): { x: number; y: number } {
  const radians = (angle - 90) * Math.PI / 180;
  return { x: cx + radius * Math.cos(radians), y: cy + radius * Math.sin(radians) };
}

function renderPie(svg: SVGSVGElement, result: TabulationResult, options: ResolvedChartOptions): void {
  const data = rankedData(result, 10).filter((item) => item.value > 0);
  const total = data.reduce((sum, item) => sum + item.value, 0);
  if (!total) return;
  const offset = titleOffset(options);
  const centerY = 250 + offset / 3;
  let angle = 0;
  data.forEach((item, index) => {
    const sweep = item.value / total * 360;
    const start = polar(300, centerY, 180, angle);
    const end = polar(300, centerY, 180, angle + sweep);
    const fill = seriesColor(index, options);
    if (sweep >= 359.999) {
      svg.append(node('circle', { cx: 300, cy: centerY, r: 180, fill, stroke: options.backgroundColor, 'stroke-width': 2 }));
    } else {
      const path = `M 300 ${centerY} L ${start.x} ${start.y} A 180 180 0 ${sweep > 180 ? 1 : 0} 1 ${end.x} ${end.y} Z`;
      svg.append(node('path', { d: path, fill, stroke: options.backgroundColor, 'stroke-width': 2 }));
    }
    angle += sweep;
    if (options.showLegend) {
      const y = 92 + offset + index * 35;
      svg.append(node('rect', { x: 575, y: y - 13, width: 15, height: 15, rx: 3, fill }));
      svg.append(node('text', { x: 602, y, class: 'chart-label' }, `${shortLabel(item.label, 25)} · ${valueText(item.value / total * 100, options)}%`));
    }
    if (options.showValueLabels && sweep >= 12) {
      const midpoint = polar(300, centerY, 115, angle - sweep / 2);
      svg.append(node('text', {
        x: midpoint.x, y: midpoint.y + 4, 'text-anchor': 'middle', class: 'chart-pie-value',
      }, `${valueText(item.value / total * 100, options)}%`));
    }
  });
}

function renderArrows(svg: SVGSVGElement, result: TabulationResult, options: ResolvedChartOptions): boolean {
  const data = arrowDataFromResult(result, titleOffset(options) ? 12 : 14);
  if (!data.length) return false;
  const values = data.flatMap((item) => [item.start, item.end]);
  const axis = resolveAxis(Math.min(0, ...values), Math.max(1, ...values), {
    min: options.axisXMin, max: options.axisXMax, tickCount: options.axisTickCount,
  });
  const span = Math.max(1e-12, axis.max - axis.min);
  const offset = titleOffset(options);
  const xFor = (value: number) => 250 + (value - axis.min) / span * 680;
  const defs = node('defs');
  const marker = node('marker', { id: 'arrow-head', markerWidth: 8, markerHeight: 8, refX: 7, refY: 4, orient: 'auto' });
  marker.append(node('path', { d: 'M0,0 L8,4 L0,8 Z', fill: options.primaryColor }));
  defs.append(marker);
  svg.append(defs);
  data.forEach((item, index) => {
    const y = 42 + offset + index * 32;
    svg.append(node('text', { x: 12, y: y + 5, class: 'chart-label' }, shortLabel(item.label, 27)));
    svg.append(node('line', {
      x1: xFor(item.start), y1: y, x2: xFor(item.end), y2: y,
      stroke: options.primaryColor, 'stroke-width': 3, 'marker-end': 'url(#arrow-head)',
    }));
    svg.append(node('circle', { cx: xFor(item.start), cy: y, r: 4, fill: options.accentColor }));
    if (options.showValueLabels) {
      svg.append(node('text', { x: 985, y: y + 5, 'text-anchor': 'end', class: 'chart-value' }, `${valueText(item.start, options)} → ${valueText(item.end, options)}`));
    }
  });
  renderSingleSeriesLegend(svg, options, 'Variação');
  return true;
}

export function renderChartSvg(
  result: TabulationResult,
  type: ChartType,
  accessibleTitle: string,
  renderOptions: ChartRenderOptions = {},
): SVGSVGElement {
  const options = resolveOptions(renderOptions, type, result);
  const svg = node('svg', { viewBox: '0 0 1000 500', role: 'img', 'aria-label': accessibleTitle });
  svg.classList.add('result-chart-svg');
  svg.append(node('rect', { x: 0, y: 0, width: 1000, height: 500, fill: options.backgroundColor, rx: 12 }));
  // Keep standalone SVG and PNG exports visually identical to the in-app chart.
  // styles.css deliberately no longer restyles these classes: while it did, the
  // screen ignored the chosen font and the export did not.
  svg.append(node('style', {}, `
    .chart-label,.chart-value,.chart-tick,.chart-empty,.chart-title,.chart-subtitle,.chart-legend,.chart-pie-value,.chart-axis-title{font-family:${fontStack(options.fontFamily)}}
    .chart-title{fill:#17241f;font-size:22px;font-weight:700}.chart-subtitle{fill:#65746f;font-size:12px}
    .chart-label{fill:#25332f;font-size:13px}.chart-value{fill:#17241f;font-size:12px;font-weight:700}
    .chart-pie-value{fill:#fff;font-size:11px;font-weight:800;paint-order:stroke;stroke:rgba(0,0,0,.2);stroke-width:2px}
    .chart-legend{fill:#42534e;font-size:11px}.chart-tick{fill:#65746f;font-size:11px}.chart-empty{fill:#65746f;font-size:16px}
    .chart-axis-title{fill:#42534e;font-size:12px;font-weight:700}
    .chart-axis{stroke:#aebbb7;stroke-width:1.5}.chart-grid{stroke:#e3ebe8;stroke-width:1}
  `));
  svg.append(node('title', {}, accessibleTitle));
  renderHeading(svg, options);
  if (type === 'horizontal-bar') renderHorizontal(svg, result, options);
  else if (type === 'pie') renderPie(svg, result, options);
  else if (type === 'arrows') {
    if (!renderArrows(svg, result, options)) {
      svg.append(node('text', { x: 500, y: 245, 'text-anchor': 'middle', class: 'chart-empty' }, 'O gráfico de setas precisa de pelo menos duas colunas.'));
    }
  } else if ((type === 'points' || type === 'bubbles') && renderScatterBound(svg, result, type, options)) {
    // Explicit x/y bindings take precedence over the legacy row-order presentation.
  } else renderCartesian(svg, result, type, options);
  return svg;
}
