import type { TabulationResult } from '../../../packages/core/src/model.ts';
import {
  arrowDataFromResult,
  chartDataFromResult,
  type ChartDatum,
  type ChartType,
} from '../../../packages/visualization/src/chart-model.ts';

const SVG_NS = 'http://www.w3.org/2000/svg';
const palette = ['#178b71', '#f16f5f', '#e1a83a', '#386fa4', '#8656a7', '#43a6a0', '#b75d69', '#77933c'];

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

function valueText(value: number): string {
  return new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 2 }).format(value);
}

function rankedData(result: TabulationResult, limit = 18): ChartDatum[] {
  return chartDataFromResult(result, { limit, order: 'ranked' });
}

function renderHorizontal(svg: SVGSVGElement, result: TabulationResult): void {
  const data = rankedData(result, 16);
  const max = Math.max(...data.map((item) => item.value), 1);
  data.forEach((item, index) => {
    const y = 34 + index * 29;
    svg.append(node('text', { x: 10, y: y + 16, class: 'chart-label' }, shortLabel(item.label, 28)));
    svg.append(node('rect', { x: 225, y, width: 650, height: 20, rx: 4, fill: '#edf3f1' }));
    svg.append(node('rect', { x: 225, y, width: Math.max(2, item.value / max * 650), height: 20, rx: 4, fill: '#178b71' }));
    svg.append(node('text', { x: 980, y: y + 16, 'text-anchor': 'end', class: 'chart-value' }, valueText(item.value)));
  });
}

function plotData(result: TabulationResult): ChartDatum[] {
  return chartDataFromResult(result, { limit: 24, order: 'source' });
}

function renderCartesian(svg: SVGSVGElement, result: TabulationResult, type: ChartType): void {
  const data = plotData(result);
  const left = 70;
  const top = 35;
  const width = 875;
  const height = 390;
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
      svg.append(node('rect', { x, y, width: barWidth, height: top + height - y, rx: 3, fill: '#178b71' }));
    });
  } else {
    const points = data.map((item, index) => `${xFor(index)},${yFor(item.value)}`).join(' ');
    if (type === 'area') {
      svg.append(node('polygon', {
        points: `${left},${top + height} ${points} ${left + width},${top + height}`,
        fill: 'rgba(23,139,113,.22)',
      }));
    }
    if (type === 'line' || type === 'area') {
      svg.append(node('polyline', { points, fill: 'none', stroke: '#178b71', 'stroke-width': 4, 'stroke-linejoin': 'round' }));
    }
    data.forEach((item, index) => {
      const radius = type === 'bubbles' ? 5 + Math.sqrt(Math.max(0, item.value) / max) * 18 : 5;
      svg.append(node('circle', {
        cx: xFor(index), cy: yFor(item.value), r: radius,
        fill: type === 'points' ? '#f16f5f' : '#178b71', opacity: type === 'bubbles' ? .72 : 1,
      }));
    });
  }
  data.forEach((item, index) => {
    if (index % Math.max(1, Math.ceil(data.length / 8)) !== 0) return;
    svg.append(node('text', { x: xFor(index), y: 454, 'text-anchor': 'middle', class: 'chart-tick' }, shortLabel(item.label, 12)));
  });
  svg.append(node('text', { x: 58, y: top + 5, 'text-anchor': 'end', class: 'chart-tick' }, valueText(max)));
  svg.append(node('text', { x: 58, y: top + height, 'text-anchor': 'end', class: 'chart-tick' }, '0'));
}

function polar(cx: number, cy: number, radius: number, angle: number): { x: number; y: number } {
  const radians = (angle - 90) * Math.PI / 180;
  return { x: cx + radius * Math.cos(radians), y: cy + radius * Math.sin(radians) };
}

function renderPie(svg: SVGSVGElement, result: TabulationResult): void {
  const data = rankedData(result, 10).filter((item) => item.value > 0);
  const total = data.reduce((sum, item) => sum + item.value, 0);
  if (!total) return;
  let angle = 0;
  data.forEach((item, index) => {
    const sweep = item.value / total * 360;
    const start = polar(300, 250, 190, angle);
    const end = polar(300, 250, 190, angle + sweep);
    const fill = palette[index % palette.length] ?? '#178b71';
    if (sweep >= 359.999) {
      svg.append(node('circle', { cx: 300, cy: 250, r: 190, fill, stroke: '#fff', 'stroke-width': 2 }));
    } else {
      const path = `M 300 250 L ${start.x} ${start.y} A 190 190 0 ${sweep > 180 ? 1 : 0} 1 ${end.x} ${end.y} Z`;
      svg.append(node('path', { d: path, fill, stroke: '#fff', 'stroke-width': 2 }));
    }
    angle += sweep;
    const y = 92 + index * 35;
    svg.append(node('rect', { x: 575, y: y - 13, width: 15, height: 15, rx: 3, fill: palette[index % palette.length] ?? '#178b71' }));
    svg.append(node('text', { x: 602, y, class: 'chart-label' }, `${shortLabel(item.label, 25)} · ${valueText(item.value / total * 100)}%`));
  });
}

function renderArrows(svg: SVGSVGElement, result: TabulationResult): boolean {
  const data = arrowDataFromResult(result, 14);
  if (!data.length) return false;
  const values = data.flatMap((item) => [item.start, item.end]);
  const min = Math.min(...values, 0);
  const max = Math.max(...values, 1);
  const xFor = (value: number) => 250 + (value - min) / Math.max(max - min, 1) * 680;
  const defs = node('defs');
  const marker = node('marker', { id: 'arrow-head', markerWidth: 8, markerHeight: 8, refX: 7, refY: 4, orient: 'auto' });
  marker.append(node('path', { d: 'M0,0 L8,4 L0,8 Z', fill: '#178b71' }));
  defs.append(marker);
  svg.append(defs);
  data.forEach((item, index) => {
    const y = 48 + index * 32;
    svg.append(node('text', { x: 12, y: y + 5, class: 'chart-label' }, shortLabel(item.label, 27)));
    svg.append(node('line', {
      x1: xFor(item.start), y1: y, x2: xFor(item.end), y2: y,
      stroke: '#178b71', 'stroke-width': 3, 'marker-end': 'url(#arrow-head)',
    }));
    svg.append(node('circle', { cx: xFor(item.start), cy: y, r: 4, fill: '#f16f5f' }));
    svg.append(node('text', { x: 985, y: y + 5, 'text-anchor': 'end', class: 'chart-value' }, `${valueText(item.start)} → ${valueText(item.end)}`));
  });
  return true;
}

export function renderChartSvg(result: TabulationResult, type: ChartType, accessibleTitle: string): SVGSVGElement {
  const svg = node('svg', { viewBox: '0 0 1000 500', role: 'img', 'aria-label': accessibleTitle });
  svg.classList.add('result-chart-svg');
  // Keep standalone SVG and PNG exports visually identical to the in-app chart.
  svg.append(node('style', {}, `
    .chart-label,.chart-value,.chart-tick,.chart-empty{font-family:Inter,ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif}
    .chart-label{fill:#25332f;font-size:13px}.chart-value{fill:#17241f;font-size:13px;font-weight:700}
    .chart-tick{fill:#65746f;font-size:11px}.chart-empty{fill:#65746f;font-size:16px}
    .chart-axis{stroke:#aebbb7;stroke-width:1.5}
  `));
  svg.append(node('title', {}, accessibleTitle));
  if (type === 'horizontal-bar') renderHorizontal(svg, result);
  else if (type === 'pie') renderPie(svg, result);
  else if (type === 'arrows') {
    if (!renderArrows(svg, result)) {
      svg.append(node('text', { x: 500, y: 245, 'text-anchor': 'middle', class: 'chart-empty' }, 'O gráfico de setas precisa de pelo menos duas colunas.'));
    }
  } else renderCartesian(svg, result, type);
  return svg;
}
