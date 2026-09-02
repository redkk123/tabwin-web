#!/usr/bin/env node
/**
 * Grava a identidade desta construção ao lado do site.
 *
 * Uma aba aberta antes de um deploy continua rodando o código antigo até
 * alguém recarregar. Isso já custou caro: uma correção de download foi
 * publicada, testada pelo usuário na mesma hora, e o que respondeu foi a
 * versão anterior — a conclusão natural teria sido "não consertou".
 *
 * O arquivo é minúsculo e a aba o relê ao voltar ao foco. Comparar é o
 * suficiente: qualquer diferença significa que existe algo mais novo no ar.
 */

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const SAIDA = 'dist-web/version.json';

function commit() {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], {
      encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    // Construção fora de um clone git ainda precisa de identidade; a data
    // basta, porque o que importa é ser diferente da construção anterior.
    return null;
  }
}

const identidade = commit() ?? `sem-git-${Date.now()}`;
fs.mkdirSync(path.dirname(SAIDA), { recursive: true });
fs.writeFileSync(SAIDA, `${JSON.stringify({ build: identidade, builtAt: new Date().toISOString() }, null, 2)}\n`);
console.log(`versão: ${identidade.slice(0, 12)}`);
