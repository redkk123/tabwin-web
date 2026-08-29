import type { TabulationResult } from '../../../packages/core/src/model.ts';
import {
  arrowDataFromResult,
  chartDataFromResult,
  scatterDataFromResult,
  type ChartDatum,
  type ChartType,
  type ScatterDatum,
} from '../../../packages/visualization/src/chart-model.ts';

const SVG_NS = 'http://www.w3.org/2000/svg';
const palette = ['#178b71', '#f16f5f', '#e1a83a', '#386fa4', '#8656a7', '#43a6a0', '#b75d69', '#77933c'];

export type ChartFontFamily = 'system' | 'serif' | 'monospace';

export interface ChartRenderOptions {
  /** Visible title; accessibility title remains a separate required argument. */
  title?: string;
  subtitle?: string;
  fontFamily?: ChartFontFamily;
  primaryColor?: string;
  accentColor?: string;
  backgroundColor?: string;
  showLegend?: boolean;
  showValueLabels?: boolean;
  decimalPlaces?: number;
  /** Explicit scatter/bubble presentation bindings. Both are required to activate XY mode. */
  xColumnKey?: string;
  yColumnKey?: string;
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
  decimalPlaces: number;
  xColumnKey?: string;
  yColumnKey?: string;
}

function resolveOptions(options: ChartRenderOptions = {}): ResolvedChartOptions {
  return {
    title: options.title?.trim() ?? '',
    subtitle: options.subtitle?.trim() ?? '',
    fontFamily: options.fontFamily ?? 'system',
    primaryColor: options.primaryColor ?? '#178b71',
    accentColor: options.accentColor ?? '#f16f5f',
    backgroundColor: options.backgroundColor ?? '#ffffff',
    showLegend: options.showLegend ?? false,
    showValueLabels: options.showValueLabels ?? false,
    decimalPlaces: Math.min(6, Math.max(0, Math.round(options.decimalPlaces ?? 2))),
    ...(options.xColumnKey ? { xColumnKey: options.xColumnKey } : {}),
    ...(options.yColumnKey ? { yColumnKey: options.yColumnKey } : {}),
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
  return new Intl.NumberFormat('pt-BR', {
    minimumFractionDigits: options.decimalPlaces,
    maximumFractionDigits: options.decimalPlaces,
  }).format(value);
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

function renderSingleSeriesLegend(svg: SVGSVGElement, options: ResolvedChartOptions, label = 'Valor'): void {
  if (!options.showLegend) return;
  svg.append(node('rect', { x: 820, y: 17, width: 14, height: 14, rx: 3, fill: options.primaryColor }));
  svg.append(node('text', { x: 842, y: 29, class: 'chart-legend' }, label));
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

function plotData(result: TabulationResult): ChartDatum[] {
  return chartDataFromResult(result, { limit: 24, order: 'source' });
}

function renderCartesian(svg: SVGSVGElement, result: TabulationResult, type: ChartType, options: ResolvedChartOptions): void {
  const data = plotData(result);
  const left = 70;
  const top = 35 + titleOffset(options);
  const width = 875;
  const height = 390 - titleOffset(options);
  const max = Math.max(...data.map((item) => item.value), 1);
  const xFor = (index: number) => left + (data.length <= 1 ? width / 2 : index / (data.length - 1) * width);
  const yFor = (value: number) => top + height - Math.max(0, value) / max * height;
  svg.append(node('line', { x1: left, y1: top, x2: left, y2: top + height, class: 'chart-axis' }));
  svg.append(node('line', { x1: left, y1: top + height, x2: left + width, y2: top + height, class: 'chart-axis' }));

  if (type === 'vertical-bar') {
    const step = width / Math.max(data.length, 1);
    data.forEach((item, index) => {
      const barWidth = Math.max(5, step * .68);
      const x = left + index * step + (step - barWidth) / 2;
      const y = yFor(item.value);
      svg.append(node('rect', { x, y, width: barWidth, height: top + height - y, rx: 3, fill: options.primaryColor }));
      if (options.showValueLabels) {
        svg.append(node('text', { x: x + barWidth / 2, y: Math.max(top + 12, y - 5), 'text-anchor': 'middle', class: 'chart-value' }, valueText(item.value, options)));
      }
    });
  } else {
    const points = data.map((item, index) => `${xFor(index)},${yFor(item.value)}`).join(' ');
    if (type === 'area') {
      svg.append(node('polygon', {
        points: `${left},${top + height} ${points} ${left + width},${top + height}`,
        fill: options.primaryColor,
        opacity: .20,
      }));
    }
    if (type === 'line' || type === 'area') {
      svg.append(node('polyline', { points, fill: 'none', stroke: options.primaryColor, 'stroke-width': 4, 'stroke-linejoin': 'round' }));
    }
    data.forEach((item, index) => {
      const radius = type === 'bubbles' ? 5 + Math.sqrt(Math.max(0, item.value) / max) * 18 : 5;
      svg.append(node('circle', {
        cx: xFor(index), cy: yFor(item.value), r: radius,
        fill: type === 'points' ? options.accentColor : options.primaryColor, opacity: type === 'bubbles' ? .72 : 1,
      }));
      if (options.showValueLabels) {
        svg.append(node('text', { x: xFor(index), y: yFor(item.value) - radius - 5, 'text-anchor': 'middle', class: 'chart-value' }, valueText(item.value, options)));
      }
    });
  }
  data.forEach((item, index) => {
    if (index % Math.max(1, Math.ceil(data.length / 8)) !== 0) return;
    svg.append(node('text', { x: xFor(index), y: 454, 'text-anchor': 'middle', class: 'chart-tick' }, shortLabel(item.label, 12)));
  });
  svg.append(node('text', { x: 58, y: top + 5, 'text-anchor': 'end', class: 'chart-tick' }, valueText(max, options)));
  svg.append(node('text', { x: 58, y: top + height, 'text-anchor': 'end', class: 'chart-tick' }, valueText(0, options)));
  renderSingleSeriesLegend(svg, options);
}

function renderScatterBound(
  svg: SVGSVGElement,
  result: TabulationResult,
  type: 'points' | 'bubbles',
  options: ResolvedChartOptions,
): boolean {
  if (!options.xColumnKey || !options.yColumnKey) return false;
  const data = scatterDataFromResult(result, options.xColumnKey, options.yColumnKey, 100);
  if (!data.length) return false;

  const left = 82;
  const top = 35 + titleOffset(options);
  const width = 850;
  const height = 390 - titleOffset(options);
  const xs = data.map((item) => item.x);
  const ys = data.map((item) => item.y);
  const xMin = Math.min(...xs, 0);
  const xMax = Math.max(...xs, 1);
  const yMin = Math.min(...ys, 0);
  const yMax = Math.max(...ys, 1);
  const sizeMax = Math.max(...data.map((item) => Math.max(0, item.value)), 1);
  const xFor = (value: number) => left + (value - xMin) / Math.max(1e-12, xMax - xMin) * width;
  const yFor = (value: number) => top + height - (value - yMin) / Math.max(1e-12, yMax - yMin) * height;

  svg.append(node('line', { x1: left, y1: top, x2: left, y2: top + height, class: 'chart-axis' }));
  svg.append(node('line', { x1: left, y1: top + height, x2: left + width, y2: top + height, class: 'chart-axis' }));
  data.forEach((item: ScatterDatum) => {
    const radius = type === 'bubbles' ? 5 + Math.sqrt(Math.max(0, item.value) / sizeMax) * 16 : 5;
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
  svg.append(node('text', { x: left, y: 454, 'text-anchor': 'middle', class: 'chart-tick' }, valueText(xMin, options)));
  svg.append(node('text', { x: left + width, y: 454, 'text-anchor': 'middle', class: 'chart-tick' }, valueText(xMax, options)));
  svg.append(node('text', { x: 68, y: top + 5, 'text-anchor': 'end', class: 'chart-tick' }, valueText(yMax, options)));
  svg.append(node('text', { x: 68, y: top + height, 'text-anchor': 'end', class: 'chart-tick' }, valueText(yMin, options)));
  if (options.showLegend) {
    const xLabel = result.columns.find((column) => column.key === options.xColumnKey)?.label ?? options.xColumnKey;
    const yLabel = result.columns.find((column) => column.key === options.yColumnKey)?.label ?? options.yColumnKey;
    svg.append(node('text', { x: 500, y: 485, 'text-anchor': 'middle', class: 'chart-legend' }, `X: ${xLabel} · Y: ${yLabel}`));
  }
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
    const fill = index === 0 ? options.primaryColor : (palette[index % palette.length] ?? options.primaryColor);
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
  const min = Math.min(...values, 0);
  const max = Math.max(...values, 1);
  const offset = titleOffset(options);
  const xFor = (value: number) => 250 + (value - min) / Math.max(max - min, 1) * 680;
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
  const options = resolveOptions(renderOptions);
  const svg = node('svg', { viewBox: '0 0 1000 500', role: 'img', 'aria-label': accessibleTitle });
  svg.classList.add('result-chart-svg');
  svg.append(node('rect', { x: 0, y: 0, width: 1000, height: 500, fill: options.backgroundColor, rx: 12 }));
  // Keep standalone SVG and PNG exports visually identical to the in-app chart.
  svg.append(node('style', {}, `
    .chart-label,.chart-value,.chart-tick,.chart-empty,.chart-title,.chart-subtitle,.chart-legend,.chart-pie-value{font-family:${fontStack(options.fontFamily)}}
    .chart-title{fill:#17241f;font-size:22px;font-weight:700}.chart-subtitle{fill:#65746f;font-size:12px}
    .chart-label{fill:#25332f;font-size:13px}.chart-value{fill:#17241f;font-size:12px;font-weight:700}
    .chart-pie-value{fill:#fff;font-size:11px;font-weight:800;paint-order:stroke;stroke:rgba(0,0,0,.2);stroke-width:2px}
    .chart-legend{fill:#42534e;font-size:11px}.chart-tick{fill:#65746f;font-size:11px}.chart-empty{fill:#65746f;font-size:16px}
    .chart-axis{stroke:#aebbb7;stroke-width:1.5}
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
