/**
 * Avisa quando o site publicado ficou mais novo que esta aba.
 *
 * Uma aba aberta antes de um deploy segue rodando o código antigo. Sem aviso,
 * quem testa uma correção recém-publicada pode receber o comportamento
 * anterior e concluir que ela não funcionou.
 *
 * A checagem acontece quando a aba volta ao foco, que é quando a pessoa vai
 * usar o programa de novo, e não em intervalo fixo: consultar de fundo uma aba
 * esquecida não ajuda ninguém e gasta rede de celular.
 */

export interface VersionWatchOptions {
  fetchImpl: typeof fetch;
  /** Chamado uma vez, quando a versão publicada passa a diferir da carregada. */
  onNewVersion: () => void;
  url?: string;
  /** Injetável para o teste não depender de eventos reais de foco. */
  subscribe?: (check: () => void) => void;
}

const DEFAULT_URL = './version.json';

async function readBuild(fetchImpl: typeof fetch, url: string): Promise<string | null> {
  try {
    // `no-store` é o ponto: com a resposta em cache, a aba compararia a versão
    // antiga consigo mesma e nunca notaria a diferença.
    const response = await fetchImpl(url, { cache: 'no-store' });
    if (!response.ok) return null;
    const payload: unknown = await response.json();
    const build = (payload as { build?: unknown } | null)?.build;
    return typeof build === 'string' && build ? build : null;
  } catch {
    // Sem rede, ou servido de um lugar sem version.json: seguir sem aviso é o
    // comportamento certo. Isto nunca pode atrapalhar o uso normal.
    return null;
  }
}

export function watchPublishedVersion(options: VersionWatchOptions): void {
  const { fetchImpl, onNewVersion, url = DEFAULT_URL } = options;
  let carregada: string | null = null;
  let avisou = false;

  const verificar = (): void => {
    if (avisou) return;
    void readBuild(fetchImpl, url).then((build) => {
      if (build === null) return;
      if (carregada === null) { carregada = build; return; }
      if (build === carregada) return;
      avisou = true;
      onNewVersion();
    });
  };

  const subscribe = options.subscribe ?? ((check: () => void) => {
    globalThis.addEventListener?.('focus', check);
    globalThis.document?.addEventListener('visibilitychange', () => {
      if (globalThis.document?.visibilityState === 'visible') check();
    });
  });

  verificar();
  subscribe(verificar);
}
