# Como contribuir

Obrigado pelo interesse. Este guia é curto de propósito: ele diz o que
você precisa para rodar o projeto, o que o CI vai exigir do seu PR, e as
poucas convenções que este repositório leva a sério.

## Rodando localmente

Você precisa de **Node 22 ou mais novo** — é a versão que o CI usa, e o
projeto depende de recursos que faltam no 20.

```bash
npm ci
npm run build
npm run web:dev
```

A aplicação sobe em `http://localhost:5173`. Ela funciona sem servidor
próprio: os dados do DATASUS chegam por um Worker que só repassa
requisições (`apps/datasus-proxy`), e a tabulação acontece inteira no
navegador.

## O que o CI exige

Rode isto antes de abrir o PR — é literalmente o que o CI roda:

```bash
npm run check:all
```

Isso encadeia quatro coisas: os testes unitários (`npm test`), a checagem
de tipos da web (`typecheck:web`), o build (`web:build`) e os testes de
ponta a ponta em Playwright (`e2e`). O Worker é verificado à parte com
`npm run proxy:check`.

Se um teste de ponta a ponta falhar de forma diferente a cada execução,
suspeite da sua máquina antes de suspeitar do seu código — eles disputam
porta e CPU com qualquer outra coisa que esteja rodando.

## Convenções que importam aqui

**Teste o comportamento, não o estado do meio do caminho.** Um teste que
afirma "o botão diz *Baixando*" corre contra o relógio e falha sozinho
mais cedo ou mais tarde. Um que afirma "a requisição de rede aconteceu"
descreve a mesma coisa e não corre contra nada.

**Comente o porquê, não o quê.** O código já diz o que faz. O que se
perde com o tempo é a razão: qual formato estranho do DATASUS obrigou
aquele desvio, qual medida derrubou a alternativa óbvia. Se você tomou
uma decisão contraintuitiva, deixe escrito o que a sustentou.

**Meça antes de otimizar, e deixe a medida no comentário.** Vários
números neste código — quantas conexões paralelas, quantos bytes por
pedaço — vieram de medição, não de intuição, e a intuição errou em mais
de um deles.

**Nada de dado de saúde real no repositório.** Fixtures são recortes
sintéticos ou arquivos públicos do DATASUS. Se precisar de um caso real
para reproduzir um bug, descreva-o no issue em vez de anexá-lo.

## Mensagens de commit

Escreva no imperativo e explique a razão no corpo. Não usamos
Conventional Commits; usamos frases que uma pessoa entende seis meses
depois. Uma linha de assunto curta, uma linha em branco, e então o
porquê.

## Abrindo um PR

Descreva o problema antes da solução, e diga como você verificou que
funciona. Se mudou algo que aparece na tela, uma captura ajuda muito.

Se o PR ficou grande, tudo bem — mas separe em commits que se leiam
sozinhos.
