# TabWin Bridge — auxiliar local de download

**Opcional.** O TabWin Web funciona inteiro sem ele. Este auxiliar existe para
um caso específico: downloads do DATASUS que o navegador não consegue concluir
— CORS, instabilidade do servidor oficial, timeout de proxy, arquivo grande
demais, conexão que cai no meio de 400 MB.

Estado: **leitura e download implementados e testados; a integração com a
interface do TabWin Web ainda não está ligada.** Hoje ele se usa por conta
própria (seção "Usar sem a interface").

---

## O que ele é, e o que ele não é

É um executor de **uma** tarefa: baixar uma URL que já passou pela allowlist do
projeto, para uma pasta que ele mesmo escolhe.

Ele **não**:

- é um proxy HTTP genérico;
- abre shell, nem aceita comando, PowerShell ou argumento vindo da página;
- escolhe executável;
- aceita destino de gravação vindo de fora;
- pede privilégio de administrador;
- fica rodando depois que você fecha.

## Modelo de ameaça, curto

O cenário que importa: **uma página web comandando um processo local**. Se a
página pudesse escolher qualquer URL, qualquer nome de arquivo ou qualquer
destino, isto deixaria de ser um auxiliar e viraria um downloader arbitrário
controlado remotamente — inclusive por uma aba que não é a do TabWin Web.

| Ameaça | O que impede |
| --- | --- |
| Outro site da máquina comandar downloads | token efêmero por sessão + allowlist de origem; sem `*` em CORS |
| Exposição para a rede local | escuta apenas em `127.0.0.1`, nunca `0.0.0.0` |
| Buscar endereço arbitrário (SSRF) | allowlist fechada de host **e** caminho; só `https` |
| Escapar da allowlist por redirecionamento | destino do `3xx` é reavaliado com a mesma regra; `--proto-redir =https` |
| Ler arquivo local / metadados de nuvem | `file://`, `http://`, IP privado e loopback recusados |
| Injeção de comando | `spawn` com array de argumentos e `shell: false`; nada é interpolado |
| Travessia de caminho / nome hostil | nome derivado da URL e higienizado, nunca aceito do cliente; nomes reservados do Windows recusados |
| Download parcial se passar por completo | grava em `.part` e só renomeia para o nome final com o download inteiro |
| Vazamento do token por timing | comparação de tempo constante |

O que **não** está resolvido está na seção "Limitações conhecidas".

## Endereços que ele pode acessar

A lista completa, e nada além dela:

| Endereço | Para quê |
| --- | --- |
| `https://datasus.saude.gov.br/wp-content/zipupload/…/arquivo.zip` | pacote preparado pelo próprio catálogo oficial a cada pedido |
| `https://ftp.datasus.gov.br/dissemin/publicos/…` | árvore pública de microdados |

Ampliar isso é decisão de segurança, não conveniência: cada linha nova é mais
uma coisa que uma página comprometida poderia mandar o processo local buscar.
A lista vive em `packages/acquisition/src/bridge-policy.ts` e é servida em
`/health`, para você conferir sem abrir o código.

## Instalar e usar

Requer **Node.js 20+** e **curl** (padrão no Windows 10+ e na maioria dos
Unix). Nada é compilado e nada é instalado no sistema.

```bash
npm run bridge:start
```

Ele imprime o endereço, a pasta de destino, a allowlist e um **token da
sessão**. O token muda toda vez que você inicia.

Opções: `--port 8787` e `--dir <pasta>`.

### Usar sem a interface

```bash
curl -H "Authorization: Bearer SEU_TOKEN" http://127.0.0.1:8787/health

curl -X POST http://127.0.0.1:8787/downloads \
  -H "Authorization: Bearer SEU_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"url":"https://ftp.datasus.gov.br/dissemin/publicos/SINAN/DADOS/FINAIS/DENGBR24.dbc"}'
```

A resposta traz um `id`; `GET /downloads/{id}` acompanha o progresso e
`POST /downloads/{id}/cancel` interrompe.

### Desinstalar

`Ctrl+C` encerra. Não há serviço, tarefa agendada, chave de registro nem
entrada de inicialização — nada sobrevive ao fechamento. Para remover de vez,
apague a pasta do repositório; os arquivos baixados ficam em
`%USERPROFILE%\Downloads\TabWin` e são seus.

## Limitações conhecidas

- **A integração com a interface não está ligada.** O provider no TabWin Web
  ainda não existe; este auxiliar hoje se usa por fora.
- **Página HTTPS falando com `127.0.0.1` depende do navegador.** Chrome e
  Firefox tratam `localhost` como origem confiável, então a chamada funciona
  com os cabeçalhos de Private Network Access que o auxiliar já envia. O Safari
  é mais restritivo e provavelmente **não** vai funcionar. Quando a integração
  automática for bloqueada, o caminho é o manual: o arquivo cai na pasta de
  downloads e você o abre no TabWin Web como qualquer outro. Não vamos
  enfraquecer proteção do navegador para "fazer funcionar".
- **`--continue-at -` retoma o `.part`, mas não confere o que já estava lá.**
  Se o servidor mudar o arquivo entre as tentativas, a retomada pode juntar
  pedaços de versões diferentes. O DATASUS republica arquivos, então isso é
  real. Enquanto não houver verificação de integridade, apague o `.part` na
  dúvida.
- **Não há verificação de hash do que foi baixado.** O TabWin Web calcula
  SHA-256 quando abre; aqui não há valor esperado com que comparar.
- **O token é impresso no terminal.** Quem enxerga o seu terminal enxerga o
  token durante aquela sessão.
- **Testado no Windows e no Linux via `curl`.** macOS deve funcionar, mas não
  foi exercitado.

## Testes

```bash
npm run build && node --test tests/bridge-policy.test.mjs tests/bridge-server.test.mjs
```

Nenhum depende do DATASUS estar no ar — um teste de segurança que só roda
quando a internet coopera não é um teste. O ciclo de download é exercitado com
um `curl` falso (`tests/fixtures/fake-curl.mjs`), o que mantém a allowlist de
produção intacta durante os testes: o que se troca é a ferramenta que a
política manda executar, nunca a política.
