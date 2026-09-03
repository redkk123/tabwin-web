# Política de segurança

## Como reportar

Use o **[Private vulnerability
reporting](https://github.com/redkk123/tabwin-web/security/advisories/new)**
do GitHub. Ele mantém o relato privado até existir correção.

Não abra issue público para vulnerabilidade. Issues são visíveis para
qualquer pessoa no momento em que são criados.

Espere uma primeira resposta em até 7 dias. Este é um projeto pequeno e
não há plantão; se o assunto for urgente, diga isso no título.

## O que está no escopo

O que interessa aqui é qualquer coisa que quebre a promessa central do
projeto: **os dados não saem do navegador de quem usa**.

Em particular:

- Qualquer caminho pelo qual microdado carregado pelo usuário chegue a um
  servidor — o nosso, o do DATASUS, ou qualquer outro.
- Execução de script vinda de conteúdo de arquivo. O aplicativo lê `.dbc`,
  `.dbf`, `.def` e `.cnv` de fonte não confiável; nenhum deles deveria
  conseguir rodar código.
- Abuso do proxy (`apps/datasus-proxy`). Ele existe para repassar um
  conjunto fechado de rotas do DATASUS. Se você conseguir fazê-lo buscar
  um endereço fora dessa lista, é vulnerabilidade — mesmo que o destino
  pareça inofensivo.
- Falha na verificação de integridade do espelho. Os hashes ficam no
  repositório, e não junto dos arquivos, justamente para que quem controla
  o bucket não controle também o que se espera dele. Um caminho que aceite
  bytes com hash divergente derruba essa separação.

## O que não está

- Falhas do próprio DATASUS ou dos servidores dele. Reporte ao DATASUS.
- Ataques que exigem acesso físico à máquina, ou uma extensão de navegador
  maliciosa já instalada.
- Ausência de cabeçalhos de segurança em páginas que não recebem entrada
  do usuário, sem um impacto demonstrável junto.
- Resultado de scanner automático sem um cenário concreto de exploração.

## Sobre os dados

O aplicativo não tem conta, não tem servidor de aplicação e não guarda
nada fora do navegador de quem usa. O que fica salvo (arquivos em cache,
cadernos do laboratório) vive em IndexedDB e sai junto com os dados do
site.

O que **sai** da máquina, e por isso é bom saber: o download busca o
arquivo no DATASUS através do proxy, e a prévia pelo TabNet manda a
pergunta a um servidor do governo. Ambos são escolhas explícitas de quem
usa, e a tela diz isso na hora.
