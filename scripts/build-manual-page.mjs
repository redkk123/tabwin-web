#!/usr/bin/env node
/**
 * Renders the user manual as a standalone page next to the application.
 *
 * A hand-written converter rather than a dependency: this project ships two
 * runtime dependencies on purpose, the input is one file we control, and the
 * Markdown it uses is a small, known subset. Anything outside that subset
 * would come out wrong silently, so the converter fails loudly instead when it
 * meets a construct it does not handle.
 */

import fs from 'node:fs';
import path from 'node:path';

const SOURCE = 'docs/product/MANUAL_DO_USUARIO.md';
const OUTPUT = 'dist-web/manual.html';
// As capturas moram ao lado do markdown para que ele também renderize no
// GitHub. O caminho relativo `./manual/x.png` vale nos dois lugares porque a
// pasta é copiada para junto do HTML gerado.
const IMAGES_FROM = 'docs/product/manual';
const IMAGES_TO = 'dist-web/manual';

const escapeHtml = (value) => value
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;');

/** Inline formatting, applied after escaping so no source text becomes markup. */
function inline(text) {
  return escapeHtml(text)
    // Code first: nothing inside a backtick span should be re-interpreted.
    .replace(/`([^`]+)`/g, (_, code) => `<code>${code}</code>`)
    // A imagem vem ANTES do link: `![alt](src)` contém `[alt](src)`, e a regra
    // de link casaria com o miolo, deixando um `!` órfão antes de uma âncora.
    .replace(/!\[([^\]]*)\]\(([^)\s]+)(?:\s+&quot;([^&]*)&quot;)?\)/g,
      (_, alt, src) => `<img src="${src}" alt="${alt}" loading="lazy">`)
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, label, href) => `<a href="${href}">${label}</a>`)
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*]+)\*/g, '$1<em>$2</em>');
}

const splitRow = (line) => line.replace(/^\||\|$/g, '').split('|').map((cell) => cell.trim());

function render(markdown) {
  const lines = markdown.split('\n');
  const html = [];
  let index = 0;

  const flushList = (tag, isOrdered) => {
    const items = [];
    const pattern = isOrdered ? /^(\d+)\.\s+(.*)$/ : /^[-*]\s+(.*)$/;
    while (index < lines.length) {
      const match = pattern.exec(lines[index]);
      if (!match) {
        // A wrapped continuation line belongs to the item above it.
        if (items.length && /^\s{2,}\S/.test(lines[index])) {
          items[items.length - 1] += ` ${lines[index].trim()}`;
          index++;
          continue;
        }
        break;
      }
      items.push(isOrdered ? match[2] : match[1]);
      index++;
    }
    html.push(`<${tag}>${items.map((item) => `<li>${inline(item)}</li>`).join('')}</${tag}>`);
  };

  while (index < lines.length) {
    const line = lines[index];

    if (!line.trim()) { index++; continue; }

    if (/^---+$/.test(line.trim())) { html.push('<hr>'); index++; continue; }

    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      const level = heading[1].length;
      const id = heading[2].toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
        .replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
      html.push(`<h${level} id="${id}">${inline(heading[2])}</h${level}>`);
      index++;
      continue;
    }

    // Table: a header row followed by a separator row.
    if (line.startsWith('|') && index + 1 < lines.length && /^\|[\s:|-]+\|$/.test(lines[index + 1])) {
      const head = splitRow(line);
      index += 2;
      const body = [];
      while (index < lines.length && lines[index].startsWith('|')) {
        body.push(splitRow(lines[index]));
        index++;
      }
      html.push(
        '<div class="table-scroll"><table><thead><tr>'
        + head.map((cell) => `<th>${inline(cell)}</th>`).join('')
        + '</tr></thead><tbody>'
        + body.map((row) => `<tr>${row.map((cell) => `<td>${inline(cell)}</td>`).join('')}</tr>`).join('')
        + '</tbody></table></div>',
      );
      continue;
    }

    if (line.startsWith('```')) {
      index++;
      const code = [];
      while (index < lines.length && !lines[index].startsWith('```')) { code.push(lines[index]); index++; }
      index++;
      html.push(`<pre><code>${escapeHtml(code.join('\n'))}</code></pre>`);
      continue;
    }

    if (line.startsWith('> ')) {
      const quote = [];
      while (index < lines.length && lines[index].startsWith('>')) {
        quote.push(lines[index].replace(/^>\s?/, ''));
        index++;
      }
      html.push(`<blockquote>${inline(quote.join(' '))}</blockquote>`);
      continue;
    }

    // Uma imagem sozinha na linha vira figura com legenda. O texto entre
    // aspas no markdown é a legenda; o alt continua descrevendo a imagem para
    // quem não a vê, que são coisas diferentes e por isso ficam separadas.
    const figura = /^!\[([^\]]*)\]\(([^)\s]+)(?:\s+"([^"]*)")?\)\s*$/.exec(line);
    if (figura) {
      const [, alt, src, legenda] = figura;
      html.push(`<figure><img src="${escapeHtml(src)}" alt="${escapeHtml(alt)}" loading="lazy">`
        + (legenda ? `<figcaption>${inline(legenda)}</figcaption>` : '')
        + '</figure>');
      index++;
      continue;
    }

    if (/^[-*]\s+/.test(line)) { flushList('ul', false); continue; }
    if (/^\d+\.\s+/.test(line)) { flushList('ol', true); continue; }

    const paragraph = [];
    while (index < lines.length && lines[index].trim()
      && !/^(#{1,6}\s|[-*]\s|\d+\.\s|>|\||```|!\[|---+$)/.test(lines[index])) {
      paragraph.push(lines[index].trim());
      index++;
    }
    if (paragraph.length) html.push(`<p>${inline(paragraph.join(' '))}</p>`);
    else index++;
  }

  return html.join('\n');
}

const markdown = fs.readFileSync(SOURCE, 'utf8');
const body = render(markdown);

const page = `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Manual do usuário — TabWin Web</title>
<style>
:root {
  --sans: Inter, ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
  --ink: #16202b; --muted: #55616e; --line: #d7dce1;
  --canvas: #eef1f4; --surface: #fff; --surface-2: #f5f7f9;
  --brand: #14548c; --brand-strong: #0e3f6c; --brand-soft: #e7edf4; --brand-line: #b4c6d8;
  --warn: #8a5a12;
}
* { box-sizing: border-box; }
body { margin: 0; background: var(--canvas); color: var(--ink); font-family: var(--sans); line-height: 1.65; }
header { padding: 22px 24px; color: #fff; background: var(--brand-strong); }
header a { color: #cddced; text-decoration: none; font-size: 14px; }
header a:hover { text-decoration: underline; }
header strong { display: block; font-size: 20px; letter-spacing: -.01em; }
main { max-width: 820px; margin: 0 auto; padding: 34px 24px 80px; }
h1 { font-size: 30px; letter-spacing: -.015em; margin: 0 0 6px; }
h2 { font-size: 22px; letter-spacing: -.01em; margin: 40px 0 12px; padding-bottom: 7px; border-bottom: 1px solid var(--line); }
h3 { font-size: 17px; margin: 26px 0 8px; }
p, li { color: #26313d; }
a { color: var(--brand); }
code { padding: 1px 5px; border-radius: 3px; background: var(--surface-2); border: 1px solid var(--line); font-family: ui-monospace, Consolas, monospace; font-size: .9em; }
pre { padding: 14px 16px; overflow-x: auto; border: 1px solid var(--line); border-radius: 6px; background: var(--surface); }
pre code { padding: 0; border: 0; background: none; }
blockquote { margin: 18px 0; padding: 12px 16px; border-left: 3px solid var(--brand-line); border-radius: 0 4px 4px 0; background: var(--brand-soft); color: #2b3b4c; }
hr { height: 0; margin: 34px 0; border: 0; border-top: 1px solid var(--line); }
.table-scroll { overflow-x: auto; margin: 16px 0; }
table { width: 100%; border-collapse: collapse; font-size: 15px; background: var(--surface); border: 1px solid var(--line); border-radius: 6px; }
th, td { padding: 9px 12px; text-align: left; border-bottom: 1px solid var(--line); vertical-align: top; }
th { background: var(--surface-2); font-weight: 600; }
tr:last-child td { border-bottom: 0; }
figure { margin: 22px 0; }
figure img { width: 100%; display: block; border: 1px solid var(--line); border-radius: 8px; background: var(--surface); }
figcaption { margin-top: 8px; color: var(--muted); font-size: 14px; line-height: 1.5; }
ul, ol { padding-left: 22px; }
li { margin: 5px 0; }
footer { max-width: 820px; margin: 0 auto; padding: 0 24px 60px; color: var(--muted); font-size: 14px; }
@media (max-width: 620px) { main { padding: 24px 16px 60px; } h1 { font-size: 25px; } }
</style>
</head>
<body>
<header>
  <strong>TabWin Web</strong>
  <a href="./index.html">← Voltar para a aplicação</a>
</header>
<main>
${body}
</main>
<footer>
  Projeto independente e não oficial. Não é afiliado ao DATASUS nem ao
  Ministério da Saúde, e não é endossado por eles.
</footer>
</body>
</html>
`;

fs.mkdirSync(path.dirname(OUTPUT), { recursive: true });
fs.writeFileSync(OUTPUT, page);

// Cada imagem citada no texto precisa existir: uma figura quebrada num manual
// é pior que nenhuma, porque quem lê fica sem saber o que deveria ver ali.
const citadas = [...markdown.matchAll(/!\[[^\]]*\]\(\.\/manual\/([^)\s]+)/g)].map((m) => m[1]);
const disponiveis = new Set(fs.existsSync(IMAGES_FROM) ? fs.readdirSync(IMAGES_FROM) : []);
const faltando = [...new Set(citadas)].filter((nome) => !disponiveis.has(nome));
if (faltando.length) {
  throw new Error(`manual cita imagens que não existem em ${IMAGES_FROM}: ${faltando.join(', ')}`);
}

// Uma imagem que não virou figura caiu no caminho de parágrafo — quase sempre
// porque a legenda tem uma aspa reta, que fecha o título antes da hora. O
// resultado ainda renderiza, então só um confronto de contagens denuncia.
const viraramFigura = (body.match(/<figure>/g) ?? []).length;
if (viraramFigura !== citadas.length) {
  throw new Error(`${citadas.length} imagens citadas mas ${viraramFigura} viraram figura: `
    + 'alguma legenda provavelmente contém aspas retas, que encerram o título markdown');
}
fs.mkdirSync(IMAGES_TO, { recursive: true });
for (const nome of disponiveis) fs.copyFileSync(path.join(IMAGES_FROM, nome), path.join(IMAGES_TO, nome));

console.log(`manual: ${OUTPUT} (${(Buffer.byteLength(page) / 1024).toFixed(0)} kB, ${citadas.length} figuras)`);
