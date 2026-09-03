import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

/**
 * O gerador do manual roda como script, não como módulo. Para testá-lo sem
 * mudar o arquivo, o teste o executa num diretório temporário com a fonte que
 * quer — que é como ele é usado de verdade.
 */
function gerar(markdown, { limiteMb = 256, segundos = 30 } = {}) {
  const raiz = fs.mkdtempSync(path.join(os.tmpdir(), 'manual-'));
  fs.mkdirSync(path.join(raiz, 'docs', 'product', 'manual'), { recursive: true });
  fs.writeFileSync(path.join(raiz, 'docs', 'product', 'MANUAL_DO_USUARIO.md'), markdown);
  fs.copyFileSync('scripts/build-manual-page.mjs', path.join(raiz, 'build.mjs'));

  execFileSync(process.execPath, [`--max-old-space-size=${limiteMb}`, 'build.mjs'], {
    cwd: raiz, timeout: segundos * 1000, stdio: 'pipe',
  });
  const html = fs.readFileSync(path.join(raiz, 'dist-web', 'manual.html'), 'utf8');
  fs.rmSync(raiz, { recursive: true, force: true });
  return html;
}

const MARKDOWN = [
  '# Título',
  '',
  'Um parágrafo.',
  '',
  '## Uma seção',
  '',
  '- primeiro item da lista',
  '- segundo item',
  '',
  'Outro parágrafo.',
].join('\n');

test('CRLF produz exatamente o mesmo HTML que LF', () => {
  // Não é preferência de estilo: com CRLF, o `\r` no fim da linha fazia o
  // padrão de lista falhar, o índice não avançava, e o laço externo repetia a
  // mesma linha até estourar a memória — 2,5 GB em 86 segundos. O CI roda em
  // Linux e nunca via; um clone no Windows travaria o build.
  const comLf = gerar(MARKDOWN);
  const comCrlf = gerar(MARKDOWN.replace(/\n/g, '\r\n'));
  assert.equal(comCrlf, comLf);
});

test('a lista sai como lista, e não como <ul> vazio', () => {
  // A forma do defeito antigo: `<ul></ul>` sem itens, repetido sem fim.
  const html = gerar(MARKDOWN.replace(/\n/g, '\r\n'));
  assert.match(html, /<li>primeiro item da lista<\/li>/);
  assert.match(html, /<li>segundo item<\/li>/);
  assert.ok(!html.includes('<ul></ul>'), 'lista vazia é o sintoma do laço que não avança');
});

test('lista numerada também sobrevive ao CRLF', () => {
  const numerada = ['# T', '', '1. um', '2. dois', ''].join('\r\n');
  const html = gerar(numerada);
  assert.match(html, /<ol><li>um<\/li><li>dois<\/li><\/ol>/);
});

test('continuação de item indentado entra no item de cima', () => {
  const quebrado = ['# T', '', '- item que continua', '  na linha seguinte', ''].join('\r\n');
  assert.match(gerar(quebrado), /<li>item que continua na linha seguinte<\/li>/);
});
