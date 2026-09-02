import { expect, test, type Page } from '@playwright/test';

/** Loads the CSV fixture and runs a UF tabulation, the shortest path to a result. */
async function tabulateFixture(page: Page): Promise<void> {
  await page.goto('/');
  await page.locator('#file-input').setInputFiles('e2e/fixtures/microdados-e2e.csv');
  await expect(page.locator('#run-button')).toBeEnabled();
  await page.locator('#row-field').selectOption('UF');
  await page.locator('#analysis-form').evaluate((form: HTMLFormElement) => form.requestSubmit());
  await expect(page.locator('#result-table tbody')).toBeVisible();
}


/**
 * Abre uma seção recolhível da barra lateral.
 *
 * As ações secundárias ficam agrupadas para a barra não ser oito botões de
 * peso igual. O teste faz o mesmo caminho de quem usa - clicar no cabeçalho -
 * em vez de forçar `open` por script, senão deixaria de exercitar a interface
 * que existe de verdade.
 */
async function openSidebarGroup(page: Page, group: 'export' | 'metadata' | 'saved'): Promise<void> {
  const details = page.locator(`#group-${group}`);
  if (await details.evaluate((element: HTMLDetailsElement) => element.open)) return;
  await details.locator('summary').click();
  await expect(details).toHaveAttribute('open', '');
}

test('abre CSV local, passa pelo Worker e produz uma tabulação', async ({ page }) => {
  await tabulateFixture(page);
  const body = page.locator('#result-table tbody');
  await expect(body).toContainText('AC');
  await expect(body).toContainText('AM');
});

test('catálogo nacional envia BR explicitamente pela interface', async ({ page }) => {
  let catalogBody = '';
  await page.route('https://datasus.saude.gov.br/wp-content/ftp.php', async (route) => {
    catalogBody = route.request().postData() ?? '';
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: { 'access-control-allow-origin': '*' },
      body: '[]',
    });
  });

  await page.goto('/');
  await page.locator('#catalog-button').click();
  await page.locator('#catalog-system').selectOption('SINAN');
  await page.locator('#catalog-file-type').selectOption('DENG');
  await page.locator('#catalog-year').selectOption(['2024']);

  // SINAN/DENG is national, so the UF control is deliberately hidden: there is
  // nothing to choose. The point of this test is that "nothing to choose" still
  // has to travel as an explicit uf[]=BR, which is the bug the national-catalog
  // fix report was written about.
  await expect(page.locator('#catalog-uf-label')).toBeHidden();
  await expect(page.locator('#catalog-uf')).toHaveValue('BR');
  // Hiding the control on its own reads as a missing feature, so the panel
  // has to say why there is nothing to pick.
  await expect(page.locator('#catalog-national-note')).toBeVisible();
  await expect(page.locator('#catalog-national-note')).toContainText('Arquivo nacional');

  await page.locator('#catalog-form').evaluate((form: HTMLFormElement) => form.requestSubmit());

  await expect.poll(() => catalogBody).not.toBe('');
  const body = new URLSearchParams(catalogBody);
  expect(body.getAll('uf[]')).toEqual(['BR']);
  expect(body.getAll('fonte[]')).toEqual(['SINAN']);
  expect(body.getAll('tipo_arquivo[]')).toEqual(['DENG']);
  expect(body.getAll('ano[]')).toEqual(['2024']);
});

test('catálogo por UF mostra o seletor e manda a UF escolhida', async ({ page }) => {
  let catalogBody = '';
  await page.route('https://datasus.saude.gov.br/wp-content/ftp.php', async (route) => {
    catalogBody = route.request().postData() ?? '';
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: { 'access-control-allow-origin': '*' },
      body: '[]',
    });
  });

  await page.goto('/');
  await page.locator('#catalog-button').click();
  await page.locator('#catalog-system').selectOption('SIHSUS');
  await page.locator('#catalog-file-type').selectOption('RD');
  // The mirror image of the test above: a per-UF collection shows the control
  // and drops the national note.
  await expect(page.locator('#catalog-uf-label')).toBeVisible();
  await expect(page.locator('#catalog-national-note')).toBeHidden();
  await page.locator('#catalog-year').selectOption(['2024']);
  await page.locator('#catalog-month').selectOption(['01']);
  await page.locator('#catalog-uf').selectOption(['MA']);
  await page.locator('#catalog-form').evaluate((form: HTMLFormElement) => form.requestSubmit());

  await expect.poll(() => catalogBody).not.toBe('');
  const body = new URLSearchParams(catalogBody);
  expect(body.getAll('uf[]')).toEqual(['MA']);
  expect(body.getAll('fonte[]')).toEqual(['SIHSUS']);
});

test('o editor de gráficos redesenha o SVG sem refazer a tabulação', async ({ page }) => {
  await tabulateFixture(page);
  const tableText = await page.locator('#result-table tbody').innerText();
  await page.locator('[data-view="chart"]').click();

  const svg = page.locator('#chart svg');
  await expect(svg).toBeVisible();
  // AC has two records and AM one, so the ranked first bar is 2. What matters
  // is that a count prints as "2" and not "2,00": that padding is the
  // regression the 4.2 review found.
  await expect(svg.locator('.chart-value').first()).toHaveText('2');

  await page.locator('#chart-title').fill('Internações por UF');
  await expect(svg.locator('.chart-title')).toHaveText('Internações por UF');

  await page.locator('#chart-primary-color').evaluate((input: HTMLInputElement) => {
    input.value = '#8656a7';
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await expect(svg.locator('rect[fill="#8656a7"]').first()).toBeAttached();

  await page.locator('#chart-decimals').selectOption('2');
  await expect(svg.locator('.chart-value').first()).toHaveText('2,00');

  // Presentation only: going back to the table shows exactly what was there
  // before. innerText on the hidden panel would read as empty and prove
  // nothing, so the tab has to be switched back first.
  await page.locator('[data-view="table"]').click();
  expect(await page.locator('#result-table tbody').innerText()).toBe(tableText);
});

test('limites de eixo inválidos são recusados e o eixo volta aos dados', async ({ page }) => {
  await tabulateFixture(page);
  await page.locator('[data-view="chart"]').click();
  await page.locator('#chart-type').selectOption('vertical-bar');

  const ticks = page.locator('#chart svg .chart-tick');
  // SVG text nodes have no innerText - allInnerTexts would silently return
  // a row of undefined and the comparison below would pass on nothing.
  const automatic = await ticks.allTextContents();

  await page.locator('#chart-axis-y-min').fill('100');
  await page.locator('#chart-axis-y-max').fill('10');
  await expect(page.locator('#toast')).toContainText('maior que o mínimo');
  expect(await ticks.allTextContents()).toEqual(automatic);

  // The same pair the right way round is honoured.
  await page.locator('#chart-axis-y-min').fill('0');
  await page.locator('#chart-axis-y-max').fill('20');
  await page.locator('#chart-axis-ticks').selectOption('4');
  expect(await ticks.allTextContents()).toContain('20');
});

test('o zoom mexe no viewBox e o reenquadrar devolve o original', async ({ page }) => {
  await tabulateFixture(page);
  await page.locator('[data-view="chart"]').click();

  const svg = page.locator('#chart svg');
  await expect(svg).toHaveAttribute('viewBox', '0 0 1000 500');
  await expect(page.locator('#chart-zoom-reset')).toBeDisabled();

  await page.locator('#chart-zoom-in').click();
  await expect(svg).not.toHaveAttribute('viewBox', '0 0 1000 500');
  await expect(page.locator('#chart-zoom-reset')).toBeEnabled();

  await page.locator('#chart-zoom-reset').click();
  await expect(svg).toHaveAttribute('viewBox', '0 0 1000 500');
  await expect(page.locator('#chart-zoom-reset')).toBeDisabled();
});

test('zoomed in, the SVG export still carries the whole chart, and leaves the on-screen zoom untouched', async ({ page }) => {
  // The chart panel's own note promises this: "O zoom é só de visualização e
  // não entra na exportação nem na receita." A regression here means the
  // reader who zoomed in to read one bar gets a cropped file that only shows
  // that bar - the export is supposed to be independent of what the screen
  // happens to be showing.
  await tabulateFixture(page);
  await page.locator('[data-view="chart"]').click();

  const svg = page.locator('#chart svg');
  await page.locator('#chart-zoom-in').click();
  await page.locator('#chart-zoom-in').click();
  const zoomedViewBox = await svg.getAttribute('viewBox');
  expect(zoomedViewBox).not.toBe('0 0 1000 500');

  const download = page.waitForEvent('download');
  await page.locator('#chart-svg-button').click();
  const file = await (await download).path();
  const exported = await (await import('node:fs/promises')).readFile(file, 'utf8');
  expect(exported).toContain('viewBox="0 0 1000 500"');

  // Exporting must not have reset what the user was actually looking at.
  await expect(svg).toHaveAttribute('viewBox', zoomedViewBox!);
  await expect(page.locator('#chart-zoom-reset')).toBeEnabled();
});

test('zoomed in, printing the chart also uses the full frame and restores the zoom afterward', async ({ page }) => {
  await tabulateFixture(page);
  await page.locator('[data-view="chart"]').click();
  // A real print dialog would block the test; window.print is stubbed so
  // printChart runs to completion synchronously and its own 1s fallback timer
  // is what puts the viewBox back, exactly as it would for a browser that
  // never fires afterprint.
  await page.evaluate(() => { window.print = () => {}; });

  const svg = page.locator('#chart svg');
  await page.locator('#chart-zoom-in').click();
  await page.locator('#chart-zoom-in').click();
  const zoomedViewBox = await svg.getAttribute('viewBox');
  expect(zoomedViewBox).not.toBe('0 0 1000 500');

  await page.locator('#chart-print-button').click();
  await expect(svg).toHaveAttribute('viewBox', '0 0 1000 500');
  await expect(page.locator('body')).toHaveAttribute('data-print-target', 'chart');

  // The 1s fallback timer restores both the marker and the on-screen zoom.
  await expect(svg).toHaveAttribute('viewBox', zoomedViewBox!, { timeout: 2000 });
  await expect(page.locator('body')).not.toHaveAttribute('data-print-target', 'chart');
});

test('a receita leva o estilo do gráfico e o traz de volta', async ({ page }) => {
  await tabulateFixture(page);
  await page.locator('[data-view="chart"]').click();
  await page.locator('#chart-title').fill('Título salvo');
  await page.locator('#chart-decimals').selectOption('3');
  await page.locator('#chart-show-legend').selectOption('on');

  const download = page.waitForEvent('download');
  await openSidebarGroup(page, 'saved');
  await page.locator('#save-recipe-button').click();
  const file = await (await download).path();

  // Wipe the editor, then let the recipe put it back. Reloading the page
  // would also drop the dataset the recipe points at, which is a different
  // test than this one.
  await page.locator('#chart-title').fill('');
  await page.locator('#chart-decimals').selectOption('');
  await page.locator('#chart-show-legend').selectOption('off');

  await page.locator('#recipe-input').setInputFiles(file);
  await expect(page.locator('#chart-title')).toHaveValue('Título salvo');
  await expect(page.locator('#chart-decimals')).toHaveValue('3');
  await expect(page.locator('#chart-show-legend')).toHaveValue('on');
  await expect(page.locator('#chart svg .chart-title')).toHaveText('Título salvo');
});

test('fluxos origem-destino agregam pelos registros e prestam contas do descarte', async ({ page }) => {
  await page.goto('/');
  await page.locator('#file-input').setInputFiles('e2e/fixtures/fluxos-e2e.csv');
  await expect(page.locator('#run-button')).toBeEnabled();
  await page.locator('#row-field').selectOption('ORIGEM');
  await page.locator('#analysis-form').evaluate((form: HTMLFormElement) => form.requestSubmit());
  await expect(page.locator('#result-table tbody')).toBeVisible();

  await page.locator('[data-view="map"]').click();
  await page.locator('#flow-origin').selectOption('ORIGEM');
  await page.locator('#flow-destination').selectOption('DESTINO');
  await page.locator('#flow-weight').selectOption('PESO');
  await page.locator('#flow-run').click();

  const report = page.locator('#flow-report');
  await expect(report).toBeVisible();
  // Three pairs survive; the fifth record has no destination and is reported,
  // never quietly folded into a total.
  await expect(report.locator('.flow-summary')).toContainText('3 par(es)');
  await expect(report.locator('.flow-summary')).toContainText('4 de 5 registros');
  await expect(report.locator('.flow-diagnostics')).toContainText('destino ausente 1');
  // 12 + 8 on the heaviest edge, ranked first.
  const first = report.locator('.flow-table tbody tr').first();
  await expect(first).toContainText('3550308');
  await expect(first).toContainText('20');
});

test('a distância só aparece depois de escolher o modelo', async ({ page }) => {
  await page.goto('/');
  await page.locator('#file-input').setInputFiles('e2e/fixtures/fluxos-e2e.csv');
  await expect(page.locator('#run-button')).toBeEnabled();
  await page.locator('#row-field').selectOption('ORIGEM');
  await page.locator('#analysis-form').evaluate((form: HTMLFormElement) => form.requestSubmit());
  await page.locator('[data-view="map"]').click();
  await page.locator('#flow-origin').selectOption('ORIGEM');
  await page.locator('#flow-destination').selectOption('DESTINO');
  await page.locator('#flow-run').click();
  await expect(page.locator('#flow-report')).toBeVisible();

  // Without a map there are no coordinates, so no distance column can exist -
  // and the default is "não calcular" anyway. Nothing invents a number here.
  const headers = await page.locator('#flow-report .flow-table th').allTextContents();
  expect(headers.some((text) => text.startsWith('Distância'))).toBe(false);
  await expect(page.locator('#flow-distance')).toHaveValue('');
});

test('o CSV do Microdatasus traz exatamente os registros aceitos pela tabulação', async ({ page }) => {
  await tabulateFixture(page);
  await openSidebarGroup(page, 'export');
  await expect(page.locator('#microdatasus-csv-button')).toBeEnabled();

  const download = page.waitForEvent('download');
  await openSidebarGroup(page, 'export');
  await page.locator('#microdatasus-csv-button').click();
  const file = await (await download).path();
  const csv = (await import('node:fs/promises')).readFile;
  const text = await csv(file, 'utf8');

  const lines = text.replace(/^﻿/, '').trim().split('\r\n');
  // Header plus one line per accepted record: the fixture has three rows and
  // no filter, so all three survive.
  expect(lines).toHaveLength(4);
  expect(lines[0]).toContain('UF');
  expect(lines[0]).toContain('SEXO');
  expect(lines[0]).toContain('VALOR');
  expect(lines.slice(1).join('\n')).toContain('AC');
  expect(lines.slice(1).join('\n')).toContain('AM');
});

test('um filtro na tabulação chega ao CSV do Microdatasus', async ({ page }) => {
  await tabulateFixture(page);
  const before = await page.locator('#result-table tbody').innerText();
  expect(before).toContain('AM');

  // The filter builder lives in a collapsed <details>; nothing inside it is
  // visible until the summary is opened.
  await page.locator('summary', { hasText: 'Filtros e seleções' }).click();
  await page.locator('#filter-field').selectOption('UF');
  await page.locator('#filter-value-search').fill('AC');
  await page.locator('#filter-values input[type="checkbox"]').first().check();
  await page.locator('#add-filter-button').click();
  await expect(page.locator('#result-table tbody')).not.toContainText('AM');

  const download = page.waitForEvent('download');
  await openSidebarGroup(page, 'export');
  await page.locator('#microdatasus-csv-button').click();
  const file = await (await download).path();
  const text = await (await import('node:fs/promises')).readFile(file, 'utf8');
  const lines = text.replace(/^﻿/, '').trim().split('\r\n');
  // Two AC records survive the filter; AM must not appear anywhere in the file.
  expect(lines).toHaveLength(3);
  expect(text).not.toContain('AM');
});

test('o histograma sobrepõe uma gaussiana ajustada, e sabe quando não pode ajustar uma', async ({ page }) => {
  await page.goto('/');
  await page.locator('#file-input').setInputFiles('e2e/fixtures/gaussian-e2e.csv');
  await expect(page.locator('#run-button')).toBeEnabled();
  await page.locator('#row-field').selectOption('VALOR');
  await page.locator('#analysis-form').evaluate((form: HTMLFormElement) => form.requestSubmit());
  await expect(page.locator('#result-table tbody')).toBeVisible();

  await page.locator('[data-view="statistics"]').click();
  await page.locator('#statistics-operation').selectOption('histogram');
  await page.locator('#statistics-x').selectOption({ index: 0 });
  await expect(page.locator('#histogram-gaussian-label')).toBeVisible();

  // Five rows (frequencies 1,2,3,2,1) is a real, non-constant series: the fit
  // succeeds and draws one mark per histogram bar.
  await page.locator('#histogram-gaussian').check();
  const marks = page.locator('.histogram-gaussian-mark');
  await expect(marks.first()).toBeVisible();
  const markCount = await marks.count();
  expect(markCount).toBeGreaterThan(0);

  await page.locator('#histogram-gaussian').uncheck();
  await expect(marks).toHaveCount(0);

  // Re-tabulating by GRUPO leaves a single row (frequency 9): a fit needs at
  // least two distinct values, so the panel must say so instead of drawing
  // nothing silently.
  await page.locator('[data-view="table"]').click();
  await page.locator('#row-field').selectOption('GRUPO');
  await page.locator('#analysis-form').evaluate((form: HTMLFormElement) => form.requestSubmit());
  await page.locator('[data-view="statistics"]').click();
  await page.locator('#statistics-operation').selectOption('histogram');
  await page.locator('#histogram-gaussian').check();
  await expect(page.locator('#statistics-result')).toContainText('A gaussiana não pôde ser ajustada');
  await expect(marks).toHaveCount(0);
});

test('a comparação de tabelas alinha por chave, reporta o que não casou e não inventa zero na divisão', async ({ page }) => {
  // Table B first: tabulated separately, saved as .twtable, then reopened
  // from inside the "Comparar" panel while A stays whatever the app already
  // has loaded - the two tables never share a session.
  await page.goto('/');
  await page.locator('#file-input').setInputFiles('e2e/fixtures/compare-b-e2e.csv');
  await expect(page.locator('#run-button')).toBeEnabled();
  await page.locator('#row-field').selectOption('UF');
  await page.locator('#analysis-form').evaluate((form: HTMLFormElement) => form.requestSubmit());
  await expect(page.locator('#result-table tbody')).toBeVisible();

  const saveDownload = page.waitForEvent('download');
  await openSidebarGroup(page, 'saved');
  await page.locator('#save-table-button').click();
  const tableBFile = await (await saveDownload).path();

  // Now load table A - AC=2, AM=1 - into the live session. B (AC=3, SP=1)
  // only ever exists as the file just saved.
  await page.locator('#file-input').setInputFiles('e2e/fixtures/compare-a-e2e.csv');
  await expect(page.locator('#run-button')).toBeEnabled();
  await page.locator('#row-field').selectOption('UF');
  await page.locator('#analysis-form').evaluate((form: HTMLFormElement) => form.requestSubmit());
  // Wait on a row only A has. Both fixtures contain AC, so asserting on that
  // is satisfied by B's still-displayed table and lets the comparison run
  // with A === B - which is exactly how this test used to fail intermittently.
  const bodyA = page.locator('#result-table tbody');
  await expect(bodyA).toContainText('AM');
  await expect(bodyA).not.toContainText('SP');

  await page.locator('[data-view="compare"]').click();
  await expect(page.locator('#compare-run-button')).toBeDisabled();
  await page.locator('#compare-open-b-button').click();
  await page.locator('#compare-b-input').setInputFiles(tableBFile!);
  await expect(page.locator('#compare-run-button')).toBeEnabled();

  await page.locator('#compare-run-button').click();
  const result = page.locator('#compare-result');
  // AC exists in both (matched); AM only in A; SP only in B.
  await expect(result).toContainText('2');
  await expect(result.locator('.compare-row-matched')).toContainText('AC');
  await expect(result.locator('.compare-row-left-only')).toContainText('AM');
  await expect(result.locator('.compare-row-right-only')).toContainText('SP');
  // AC: A=2, B=3, difference=1 - never a fabricated zero for the unmatched rows.
  const acRow = result.locator('.compare-row-matched');
  await expect(acRow).toContainText('3,00');
  await expect(acRow).toContainText('1,00');
  const unmatchedCells = result.locator('.compare-row-left-only td, .compare-row-right-only td');
  await expect(unmatchedCells.filter({ hasText: '—' }).first()).toBeVisible();

  const download = page.waitForEvent('download');
  await page.locator('#compare-export-button').click();
  const exported = await (await download).path();
  const text = await (await import('node:fs/promises')).readFile(exported!, 'utf8');
  expect(text.replace(/^﻿/, '')).toContain('AC');
  expect(text).toContain('AM');
  expect(text).toContain('SP');
});

test('a auditoria estatística encontra um sinal real, nunca vaza o rótulo interno e "Focar campo" abre a ferramenta certa', async ({ page }) => {
  // 40 reference records (adult ages, MUNIC spread over 8 codes) plus 20
  // group records (IDADE=8, 18/20 concentrated in MUNIC=M007, mostly
  // EVOLUCAO=ignorado, one DIAS=90 outlier) - the same shape of anomaly the
  // module was built to generalize from, not hardcoded to any one disease.
  await page.goto('/');
  await page.locator('#file-input').setInputFiles('e2e/fixtures/investigate-e2e.csv');
  await expect(page.locator('#run-button')).toBeEnabled();

  await page.locator('[data-view="investigate"]').click();
  await expect(page.locator('#investigate-run-button')).toBeDisabled();
  await expect(page.locator('#investigate-gate-message')).toContainText('filtro ativo');

  // Define the group under investigation: the 20 IDADE=8 records. The
  // filter builder lives in a collapsed <details>; open it first.
  await page.locator('summary', { hasText: 'Filtros e seleções' }).click();
  await page.locator('#filter-field').selectOption('IDADE');
  await page.locator('#filter-kind').selectOption('numeric-range');
  await page.locator('#filter-maximum').fill('10');
  await page.locator('#add-filter-button').click();
  await expect(page.locator('#investigate-gate-message')).toContainText('campo numérico ou categórico');

  await page.locator('#investigate-numeric-fields').selectOption('DIAS');
  await page.locator('#investigate-categorical-fields').selectOption(['MUNIC', 'EVOLUCAO']);
  await page.locator('#investigate-geography-fields').selectOption('MUNIC');
  await expect(page.locator('#investigate-run-button')).toBeEnabled();
  await expect(page.locator('#investigate-gate-message')).toHaveText('');

  await page.locator('#investigate-run-button').click();
  const result = page.locator('#investigate-result');
  await expect(result).toContainText('Grupo: 20 registro(s)');
  await expect(result).toContainText('Referência: 40 registro(s)');
  await expect(result.getByText('força da evidência, não probabilidade de erro').first()).toBeVisible();

  // The concentration signal must show the real category name (M007) -
  // never a raw internal sentinel, which is exactly what once leaked here
  // before the cardinality-overflow bucket's key was fixed and translated.
  const munCard = page.locator('.investigate-signal', { hasText: 'Concentração incomum de MUNIC' });
  await expect(munCard).toContainText('M007');
  await expect(munCard).not.toContainText('outras_categorias');

  // The seeded DIAS=90 outlier must also surface as its own signal.
  await expect(page.locator('.investigate-signal', { hasText: 'Valores extremos em DIAS' })).toBeVisible();

  await munCard.getByRole('button', { name: 'Focar campo' }).click();
  await expect(page.locator('#filter-field')).toHaveValue('MUNIC');

  // "Marcar como esperado" is session-local: it hides the card, offers a
  // restore, and a fresh run does not resurrect it on its own.
  await page.locator('[data-view="investigate"]').click();
  await munCard.getByRole('button', { name: 'Marcar como esperado' }).click();
  await expect(page.locator('.investigate-signal', { hasText: 'Concentração incomum de MUNIC' })).toHaveCount(0);
  const restoreButton = result.getByRole('button', { name: /Restaurar/ });
  await expect(restoreButton).toBeVisible();

  await page.locator('#investigate-run-button').click();
  await expect(page.locator('.investigate-signal', { hasText: 'Concentração incomum de MUNIC' })).toHaveCount(0);

  await restoreButton.click();
  await expect(page.locator('.investigate-signal', { hasText: 'Concentração incomum de MUNIC' })).toBeVisible();
});

test('the transform pipeline recodes, marks missing, filters, dedupes and drops columns - reproducibly, without touching the original file', async ({ page }) => {
  await page.goto('/');
  await page.locator('#file-input').setInputFiles('e2e/fixtures/investigate-e2e.csv');
  await expect(page.locator('#run-button')).toBeEnabled();
  await page.locator('summary', { hasText: 'Transformar dados' }).click();

  // Step 1: recode SEXO M/F into full words.
  await page.locator('#transform-step-kind').selectOption('recode');
  await page.locator('#transform-recode-field').selectOption('SEXO');
  const recodeInputs = page.locator('#transform-recode-rows input');
  await recodeInputs.nth(0).fill('M');
  await recodeInputs.nth(1).fill('Masculino');
  await page.locator('#transform-recode-add-row').click();
  await recodeInputs.nth(2).fill('F');
  await recodeInputs.nth(3).fill('Feminino');
  await page.locator('#transform-add-step').click();

  // Step 2: EVOLUCAO="ignorado" becomes analytically missing.
  await page.locator('#transform-step-kind').selectOption('missing-value-policy');
  await page.locator('#transform-missing-field').selectOption('EVOLUCAO');
  await page.locator('#transform-missing-values').fill('ignorado');
  await page.locator('#transform-add-step').click();

  // Step 3: keep only IDADE >= 10 - drops the 20 seeded group records.
  await page.locator('#transform-step-kind').selectOption('filter-rows');
  await page.locator('#transform-filter-field').selectOption('IDADE');
  await page.locator('#transform-filter-kind').selectOption('numeric-range');
  await page.locator('#transform-filter-minimum').fill('10');
  await page.locator('#transform-add-step').click();

  // Step 4: dedupe by the now-recoded SEXO + EVOLUCAO.
  await page.locator('#transform-step-kind').selectOption('dedupe');
  await page.locator('#transform-dedupe-fields').selectOption(['SEXO', 'EVOLUCAO']);
  await page.locator('#transform-add-step').click();

  // Step 5: drop every column except MUNIC/IDADE/SEXO.
  await page.locator('#transform-step-kind').selectOption('select-columns');
  await page.locator('#transform-select-fields').selectOption(['MUNIC', 'IDADE', 'SEXO']);
  await page.locator('#transform-add-step').click();

  await expect(page.locator('#transform-count')).toContainText('5 etapa');

  await page.locator('#transform-apply-button').click();
  const result = page.locator('#transform-result');
  await expect(result).toContainText('60 → 40');
  await expect(result).toContainText('registrosRemovidos: 20');
  await expect(result).toContainText('40 → 3');
  await expect(result).toContainText('3 → 3');

  // The schema everywhere else in the app reflects the transformed dataset.
  const rowFieldOptions = await page.locator('#row-field option').allTextContents();
  expect(rowFieldOptions.some((text) => text.includes('EVOLUCAO'))).toBe(false);
  expect(rowFieldOptions.some((text) => text.includes('UF'))).toBe(false);

  await page.locator('#row-field').selectOption('SEXO');
  await page.locator('#analysis-form').evaluate((form) => form.requestSubmit());
  await expect(page.locator('#result-table tbody')).toContainText('Feminino');
  await expect(page.locator('#result-table tbody')).toContainText('Masculino');
  await expect(page.locator('#result-table')).toContainText('3');

  // Re-running "Aplicar" is idempotent: it starts from the untransformed
  // original every time, never compounding onto its own previous output.
  await page.locator('#transform-apply-button').click();
  await expect(result).toContainText('40 → 3');
  const secondRunText = await result.textContent();
  await page.locator('#transform-apply-button').click();
  await expect(result).toContainText('40 → 3');
  await expect(result).toHaveText(secondRunText ?? '');

  // The original file itself was never touched: restoring brings every
  // column and the raw M/F values straight back.
  await page.locator('#transform-reset-button').click();
  // resetTransformPipelineData() is async - wait for the row-field dropdown
  // to actually reflect the restored schema instead of racing it.
  await expect(page.locator('#row-field')).toContainText('EVOLUCAO');
  await page.locator('#row-field').selectOption('SEXO');
  await page.locator('#analysis-form').evaluate((form) => form.requestSubmit());
  const restoredBody = page.locator('#result-table tbody');
  await expect(restoredBody).toContainText('F');
  await expect(restoredBody).not.toContainText('Feminino');
  await expect(page.locator('#result-table')).toContainText('60');
});

test('recipes save the applied pipeline, failures stop replay, and an empty transform clears the old table', async ({ page }) => {
  await page.goto('/');
  await page.locator('#file-input').setInputFiles('e2e/fixtures/investigate-e2e.csv');
  await expect(page.locator('#run-button')).toBeEnabled();
  await page.locator('summary', { hasText: 'Transformar dados' }).click();

  await page.locator('#transform-step-kind').selectOption('filter-rows');
  await page.locator('#transform-filter-field').selectOption('IDADE');
  await page.locator('#transform-filter-kind').selectOption('numeric-range');
  await page.locator('#transform-filter-minimum').fill('10');
  await page.locator('#transform-add-step').click();
  await page.locator('#transform-apply-button').click();
  await expect(page.locator('#transform-result')).toContainText('60 → 40');
  await expect(page.locator('#result-table')).toContainText('40');

  // Add a second draft step but do not apply it. The recipe must describe the
  // dataset that produced the visible table (one applied step), not this draft.
  await page.locator('#transform-filter-minimum').fill('1000');
  await page.locator('#transform-add-step').click();
  await expect(page.locator('#transform-count')).toContainText('2 etapa');
  const download = page.waitForEvent('download');
  await openSidebarGroup(page, 'saved');
  await page.locator('#save-recipe-button').click();
  const recipeFile = await (await download).path();
  if (!recipeFile) throw new Error('the browser did not expose the saved recipe path');

  // Applying both steps removes every record. The previous 40-row table must
  // disappear and, critically, may no longer be exported or saved as current.
  await page.locator('#transform-apply-button').click();
  await expect(page.locator('#transform-result')).toContainText('40 → 0');
  await expect(page.locator('#result-title')).toContainText('não contém registros');
  await expect(page.locator('#table-wrap')).toBeHidden();
  await expect(page.locator('#save-recipe-button')).toBeDisabled();

  await page.locator('#transform-reset-button').click();
  await expect(page.locator('#result-table tbody')).toBeVisible();
  await page.locator('#recipe-input').setInputFiles(recipeFile);
  await expect(page.locator('#transform-count')).toContainText('1 etapa');
  await expect(page.locator('#result-table')).toContainText('40');

  // A runtime-invalid pipeline must stop recipe replay instead of being caught
  // and followed by a misleading "reproduced" success over the raw dataset.
  await page.locator('#recipe-input').setInputFiles('e2e/fixtures/invalid-transform-e2e.twrecipe');
  await expect(page.locator('#toast')).toContainText('não puderam ser aplicadas');
  await expect(page.locator('#toast')).not.toContainText('reproduzida');
});

test('a DEF G directive weights frequency in the UI and the saved measure replays without the DEF', async ({ page }) => {
  await page.goto('/');
  await page.locator('#file-input').setInputFiles([
    'e2e/fixtures/grouped-frequency-e2e.def',
    'e2e/fixtures/grouped-frequency-e2e.csv',
  ]);
  const body = page.locator('#result-table tbody');
  await expect(body).toBeVisible();
  await expect(body.locator('tr', { hasText: 'AC' })).toContainText('7');
  await expect(body.locator('tr', { hasText: 'DF' })).toContainText('10');

  await page.reload();
  await page.locator('#file-input').setInputFiles('e2e/fixtures/grouped-frequency-e2e.csv');
  await expect(page.locator('#result-table tbody')).toBeVisible();
  await page.locator('#recipe-input').setInputFiles('e2e/fixtures/grouped-frequency-e2e.twrecipe');
  await expect(page.locator('#result-table tbody').locator('tr', { hasText: 'AC' })).toContainText('7');
});

test('Excel-style formulas compute a derived column, and the advertised function list comes from the engine itself', async ({ page }) => {
  await page.goto('/');
  await page.locator('#file-input').setInputFiles('e2e/fixtures/investigate-e2e.csv');
  await expect(page.locator('#run-button')).toBeEnabled();
  await page.locator('#row-field').selectOption('MUNIC');
  await page.locator('#analysis-form').evaluate((form: HTMLFormElement) => form.requestSubmit());
  await expect(page.locator('#result-table tbody')).toContainText('M007');

  // The function reference only appears for the formula operation, and its
  // contents are rendered from the parser's own catalog - never a hand-kept
  // copy that could advertise something the engine would reject.
  await expect(page.locator('#formula-help')).toBeHidden();
  await page.locator('#table-operation-kind').selectOption('expression');
  await expect(page.locator('#formula-help')).toBeVisible();
  await expect(page.locator('#formula-function-count')).toContainText('funções');
  await expect(page.locator('.formula-function-group')).not.toHaveCount(0);

  // A pt-BR Excel user's reflexes: leading "=", Portuguese names, semicolon
  // separators, a comparison, and nesting - all in one formula.
  await page.locator('#table-operation-expression')
    .fill('=SE([Frequência] > 5; ARRED(TAXA([Frequência]; 1000; 1000); 1); 0)');
  await page.locator('#table-operation-label').fill('Taxa condicional');
  await page.locator('#table-operation-apply').click();

  const table = page.locator('#result-table');
  await expect(table).toContainText('Taxa condicional');
  // M007 has 23 records (> 5, so it keeps its rate); M003 has 5 (not > 5, so 0).
  const m007 = page.locator('#result-table tbody tr', { hasText: 'M007' });
  await expect(m007).toContainText('23');
  const m003 = page.locator('#result-table tbody tr', { hasText: 'M003' });
  await expect(m003).toContainText('0');

  // LAG reads the row above; without IFERROR the first row would have no
  // predecessor to read, which is an error rather than an invented zero.
  await page.locator('#table-operation-reset').click();
  await page.locator('#table-operation-kind').selectOption('expression');
  await page.locator('#table-operation-expression').fill('LAG([Frequência])');
  await page.locator('#table-operation-label').fill('Sem IFERROR');
  await page.locator('#table-operation-apply').click();
  await expect(page.locator('#toast')).toContainText('LAG');
  await expect(table).not.toContainText('Sem IFERROR');

  // Named the same way an Excel user would, the escape hatch works.
  await page.locator('#table-operation-expression').fill('IFERROR(LAG([Frequência]); 0)');
  await page.locator('#table-operation-label').fill('Anterior');
  await page.locator('#table-operation-apply').click();
  await expect(table).toContainText('Anterior');

  // A name outside the registry is refused by name - nothing is executed.
  await page.locator('#table-operation-expression').fill('eval(1)');
  await page.locator('#table-operation-label').fill('Proibida');
  await page.locator('#table-operation-apply').click();
  await expect(page.locator('#toast')).toContainText('unknown function eval');
  await expect(table).not.toContainText('Proibida');
});

test('the transform pipeline computes a new field with the same formula language, over records', async ({ page }) => {
  await page.goto('/');
  await page.locator('#file-input').setInputFiles('e2e/fixtures/investigate-e2e.csv');
  await expect(page.locator('#run-button')).toBeEnabled();
  await page.locator('summary', { hasText: 'Transformar dados' }).click();

  // mutate(): DIAS and IDADE are real fields of the record, not columns of a
  // tabulation - the same engine, addressed against the dataset's own schema.
  await page.locator('#transform-step-kind').selectOption('derive-column');
  await page.locator('#transform-derive-field').fill('DIAS_POR_ANO');
  await page.locator('#transform-derive-formula').fill('=ARRED(RAZÃO([DIAS]; [IDADE]); 3)');
  await page.locator('#transform-add-step').click();
  await expect(page.locator('#transform-count')).toContainText('1 etapa');

  await page.locator('#transform-apply-button').click();
  await expect(page.locator('#transform-result')).toContainText('registrosCalculados: 60');

  // The derived field is a real field of the transformed dataset now, so it
  // can be tabulated like any other.
  await expect(page.locator('#row-field')).toContainText('DIAS_POR_ANO');
  await page.locator('#row-field').selectOption('DIAS_POR_ANO');
  await page.locator('#analysis-form').evaluate((form: HTMLFormElement) => form.requestSubmit());
  await expect(page.locator('#result-table tbody')).toBeVisible();

  // A formula whose name is outside the registry is refused here too, and
  // the dataset is left exactly as it was.
  await page.locator('#transform-step-kind').selectOption('derive-column');
  await page.locator('#transform-derive-field').fill('PROIBIDA');
  await page.locator('#transform-derive-formula').fill('eval(1)');
  await page.locator('#transform-add-step').click();
  await page.locator('#transform-apply-button').click();
  await expect(page.locator('#transform-result')).toContainText('unknown function eval');
  await expect(page.locator('#row-field')).not.toContainText('PROIBIDA');
});

test('the cleaning steps standardize an IBGE code and derive the epidemiological week', async ({ page }) => {
  await page.goto('/');
  await page.locator('#file-input').setInputFiles('e2e/fixtures/limpeza-e2e.csv');
  await expect(page.locator('#run-button')).toBeEnabled();
  await page.locator('summary', { hasText: 'Transformar dados' }).click();

  // The flagship example: 5300108 (7 digits, with check digit) and 11001
  // (5 digits, leading zero eaten) both have to land on the 6-digit form
  // every DATASUS municipality table keys on.
  await page.locator('#transform-step-kind').selectOption('text-normalize');
  await page.locator('#transform-text-field').selectOption('MUN');
  await page.locator('#transform-text-operations').selectOption(['ibge-municipality']);
  await page.locator('#transform-add-step').click();

  await page.locator('#transform-step-kind').selectOption('date-part');
  await page.locator('#transform-datepart-field').selectOption('DT');
  await page.locator('#transform-datepart-part').selectOption('epidemiological-week');
  await page.locator('#transform-datepart-target').fill('SE');
  await page.locator('#transform-add-step').click();

  await page.locator('#transform-step-kind').selectOption('date-part');
  await page.locator('#transform-datepart-part').selectOption('epidemiological-year');
  await page.locator('#transform-datepart-target').fill('ANO_SE');
  await page.locator('#transform-add-step').click();

  await page.locator('#transform-apply-button').click();
  const report = page.locator('#transform-result');
  await expect(report).toContainText('naoReconhecidos: 0');
  await expect(report).toContainText('semDataValida: 0');

  await page.locator('#row-field').selectOption('MUN');
  await page.locator('#analysis-form').evaluate((form: HTMLFormElement) => form.requestSubmit());
  const body = page.locator('#result-table tbody');
  // 5300108 lost its check digit and joined the existing 530010 (so: 2),
  // and 11001 got its leading zero back.
  await expect(body).toContainText('011001');
  await expect(body.locator('tr', { hasText: '530010' })).toContainText('2');
  await expect(body).not.toContainText('5300108');

  // 31 Dec 2023 belongs to epidemiological week 1 of 2024, which is exactly
  // why the epidemiological year is its own column.
  await page.locator('#row-field').selectOption('ANO_SE');
  await page.locator('#analysis-form').evaluate((form: HTMLFormElement) => form.requestSubmit());
  await expect(body).toContainText('2024');
  await expect(body).not.toContainText('2023');

  await page.locator('#row-field').selectOption('SE');
  await page.locator('#analysis-form').evaluate((form: HTMLFormElement) => form.requestSubmit());
  // 31/12/2023 -> 1, 07/01 -> 2, 15/01 -> 3, 01/07 -> 27: four distinct
  // weeks, one record each. The row label is each row's first cell.
  await expect(body.locator('tr')).toHaveCount(4);
  expect(await body.locator('tr > :first-child').allTextContents()).toEqual(['1', '2', '3', '27']);
});

test('group-summarize collapses the dataset to one row per key, with N and a sum', async ({ page }) => {
  await page.goto('/');
  await page.locator('#file-input').setInputFiles('e2e/fixtures/grupo-e2e.csv');
  await expect(page.locator('#run-button')).toBeEnabled();
  await page.locator('summary', { hasText: 'Transformar dados' }).click();

  // Keep only confirmed first, then N and total VALOR by UF - the shape of
  // the region-by-year summary the spec's own example ends on.
  await page.locator('#transform-step-kind').selectOption('filter-rows');
  await page.locator('#transform-filter-field').selectOption('CLASSI');
  await page.locator('#transform-filter-categories').fill('1');
  await page.locator('#transform-add-step').click();

  await page.locator('#transform-step-kind').selectOption('group-summarize');
  await page.locator('#transform-group-fields').selectOption(['UF']);
  // First aggregation row defaults to count/N; add a sum of VALOR.
  await page.locator('#transform-group-add-agg').click();
  const secondRow = page.locator('#transform-group-aggregations > div').nth(1);
  await secondRow.locator('select').first().selectOption('sum');
  await secondRow.locator('select').nth(1).selectOption('VALOR');
  await secondRow.locator('input').fill('TOTAL');
  await page.locator('#transform-add-step').click();

  await page.locator('#transform-apply-button').click();
  await expect(page.locator('#transform-result')).toContainText('gruposFormados: 2');

  // The dataset now has exactly the key and summary fields, and one row per UF.
  await expect(page.locator('#row-field')).toContainText('TOTAL');
  await page.locator('#row-field').selectOption('UF');
  // Sum the derived TOTAL column so the row values are checkable.
  await page.locator('#measure-kind').selectOption('sum');
  await page.locator('#measure-field').selectOption('TOTAL');
  await page.locator('#analysis-form').evaluate((form: HTMLFormElement) => form.requestSubmit());

  const body = page.locator('#result-table tbody');
  await expect(body.locator('tr')).toHaveCount(2);
  // SP kept records 2 and 3 (20 + 30 = 50); the 40 was CLASSI=2, filtered out.
  await expect(body.locator('tr', { hasText: 'SP' })).toContainText('50');
  await expect(body.locator('tr', { hasText: 'DF' })).toContainText('10');
});

test('"Ver código equivalente" renders the pipeline as dplyr and pandas, without running anything', async ({ page }) => {
  await page.goto('/');
  await page.locator('#file-input').setInputFiles('e2e/fixtures/grupo-e2e.csv');
  await expect(page.locator('#run-button')).toBeEnabled();
  await page.locator('summary', { hasText: 'Transformar dados' }).click();

  // The button only means something once there is a pipeline to render.
  await expect(page.locator('#transform-code-toggle')).toBeDisabled();

  await page.locator('#transform-step-kind').selectOption('filter-rows');
  await page.locator('#transform-filter-field').selectOption('CLASSI');
  await page.locator('#transform-filter-categories').fill('1');
  await page.locator('#transform-add-step').click();
  await page.locator('#transform-step-kind').selectOption('group-summarize');
  await page.locator('#transform-group-fields').selectOption(['UF']);
  await page.locator('#transform-add-step').click();

  await expect(page.locator('#transform-code-toggle')).toBeEnabled();
  await page.locator('#transform-code-toggle').click();
  const code = page.locator('#transform-code-output');
  await expect(page.locator('#transform-code')).toBeVisible();
  // dplyr by default.
  await expect(code).toContainText('library(dplyr)');
  await expect(code).toContainText('dplyr::filter(CLASSI %in% c("1"))');
  await expect(code).toContainText('dplyr::group_by(UF)');

  await page.locator('#transform-code-target').selectOption('python');
  await expect(code).toContainText('import pandas as pd');
  await expect(code).toContainText('df.groupby(["UF"]');

  // It is a view, not an action: the dataset is untouched by opening it.
  await expect(page.locator('#transform-result')).toBeEmpty();

  await page.locator('#transform-code-toggle').click();
  await expect(page.locator('#transform-code')).toBeHidden();
});

test('bind-rows stacks a second base, unions columns, and marks each record\'s origin', async ({ page }) => {
  await page.goto('/');
  await page.locator('#file-input').setInputFiles('e2e/fixtures/bind-a-e2e.csv');
  await expect(page.locator('#run-button')).toBeEnabled();
  await page.locator('summary', { hasText: 'Transformar dados' }).click();

  await page.locator('#transform-step-kind').selectOption('bind-rows');
  // The second base is loaded through its own file input, not the main one.
  await page.locator('#transform-bind-file-input').setInputFiles('e2e/fixtures/bind-b-e2e.csv');
  await expect(page.locator('#transform-bind-status')).toContainText('bind-b');
  await page.locator('#transform-bind-origin-check').check();
  await page.locator('#transform-bind-current-label').fill('base_a');
  await page.locator('#transform-add-step').click();

  await page.locator('#transform-apply-button').click();
  const report = page.locator('#transform-result');
  await expect(report).toContainText('registrosAdicionados: 2');
  await expect(report).toContainText('colunasSoFonte: 1');

  // The union carries both bases' columns plus the origin marker.
  const rowField = page.locator('#row-field');
  await expect(rowField).toContainText('INTERNACOES');
  await expect(rowField).toContainText('FONTE_ORIGEM');

  // OBITOS exists only in base A, so summing it by origin gives 30 for base_a
  // and nothing for the other base - a null, never a fabricated zero row.
  await page.locator('#row-field').selectOption('FONTE_ORIGEM');
  await page.locator('#measure-kind').selectOption('sum');
  await page.locator('#measure-field').selectOption('OBITOS');
  await page.locator('#analysis-form').evaluate((form: HTMLFormElement) => form.requestSubmit());
  const body = page.locator('#result-table tbody');
  await expect(body.locator('tr', { hasText: 'base_a' })).toContainText('30');
  await expect(body.locator('tr')).toHaveCount(1);
});

test('join brings a second base\'s column onto the records by key, keeping the left side', async ({ page }) => {
  await page.goto('/');
  await page.locator('#file-input').setInputFiles('e2e/fixtures/join-casos-e2e.csv');
  await expect(page.locator('#run-button')).toBeEnabled();
  await page.locator('summary', { hasText: 'Transformar dados' }).click();

  await page.locator('#transform-step-kind').selectOption('join');
  await page.locator('#transform-join-file-input').setInputFiles('e2e/fixtures/join-pop-e2e.csv');
  await expect(page.locator('#transform-join-status')).toContainText('join-pop');
  await page.locator('#transform-join-type').selectOption('left');
  await page.locator('#transform-join-key-current').selectOption('UF');
  await page.locator('#transform-join-key-source').selectOption('UF');
  await page.locator('#transform-add-step').click();

  await page.locator('#transform-apply-button').click();
  const report = page.locator('#transform-result');
  // AC and AM match; SP has no population row; RJ (source-only) is dropped by left.
  await expect(report).toContainText('registrosCorrespondentes: 2');
  await expect(report).toContainText('registrosSoFonte: 0');

  await expect(page.locator('#row-field')).toContainText('POPULACAO');
  await page.locator('#row-field').selectOption('UF');
  await page.locator('#measure-kind').selectOption('sum');
  await page.locator('#measure-field').selectOption('POPULACAO');
  await page.locator('#analysis-form').evaluate((form: HTMLFormElement) => form.requestSubmit());
  const body = page.locator('#result-table tbody');
  // AC=900, AM=4200; SP joined to nothing so its population is null, not a
  // fabricated zero - its row is suppressed and the total is just 5.100.
  await expect(body.locator('tr', { hasText: 'AC' })).toContainText('900');
  await expect(body.locator('tr', { hasText: 'AM' })).toContainText('4.200');
  await expect(body.locator('tr', { hasText: 'SP' })).toHaveCount(0);
});

test('the epidemiology panel gives crude and age-standardized rates with confidence intervals', async ({ page }) => {
  await page.goto('/');
  await page.locator('#file-input').setInputFiles('e2e/fixtures/epi-e2e.csv');
  await expect(page.locator('#run-button')).toBeEnabled();

  // Build a table with age-group rows and events/population/standard columns.
  await page.locator('#row-field').selectOption('FAIXA');
  await page.locator('#measure-kind').selectOption('sum');
  await page.locator('#measure-field').selectOption('OBITOS');
  await page.locator('summary', { hasText: 'Medidas adicionais' }).click();
  for (const field of ['POP', 'PADRAO', 'TXREF']) {
    await page.locator('#extra-measure-field').selectOption(field);
    await page.locator('#extra-measure-add').click();
  }
  await page.locator('#analysis-form').evaluate((form: HTMLFormElement) => form.requestSubmit());
  await expect(page.locator('#result-table tbody')).toBeVisible();

  await page.locator('[data-view="statistics"]').click();
  await page.locator('#statistics-operation').selectOption('epidemiology');
  await page.locator('#statistics-x').selectOption('0'); // events (OBITOS)
  await page.locator('#statistics-y').selectOption('1'); // population (POP)
  await page.locator('#epi-standard').selectOption('2'); // standard weight (PADRAO)
  await page.locator('#epi-per').selectOption('1000');

  const result = page.locator('#statistics-result');
  // Crude 30/1500 = 20 per 1000; standardized with equal weights:
  // (6/1000 + 24/500)/2 = 0.027 -> 27 per 1000.
  await expect(result).toContainText('Taxa bruta');
  await expect(result).toContainText('20');
  await expect(result).toContainText('Taxa padronizada');
  await expect(result).toContainText('27');
  // The old stratum's own crude rate is 48 per 1000, with a Byar interval.
  await expect(result.locator('tr', { hasText: '60+' })).toContainText('48');
  await expect(result).toContainText('Byar');

  // Dropping the standard leaves only the crude rate - no standardized card.
  await page.locator('#epi-standard').selectOption('');
  await expect(result).toContainText('Taxa bruta');
  await expect(result).not.toContainText('Taxa padronizada');
});

test('the indirect method reports observed against expected as an SMR, and reads the interval out loud', async ({ page }) => {
  await page.goto('/');
  await page.locator('#file-input').setInputFiles('e2e/fixtures/epi-e2e.csv');
  await expect(page.locator('#run-button')).toBeEnabled();

  await page.locator('#row-field').selectOption('FAIXA');
  await page.locator('#measure-kind').selectOption('sum');
  await page.locator('#measure-field').selectOption('OBITOS');
  await page.locator('summary', { hasText: 'Medidas adicionais' }).click();
  for (const field of ['POP', 'PADRAO', 'TXREF']) {
    await page.locator('#extra-measure-field').selectOption(field);
    await page.locator('#extra-measure-add').click();
  }
  await page.locator('#analysis-form').evaluate((form: HTMLFormElement) => form.requestSubmit());
  await expect(page.locator('#result-table tbody')).toBeVisible();

  await page.locator('[data-view="statistics"]').click();
  await page.locator('#statistics-operation').selectOption('epidemiology');
  await page.locator('#epi-method').selectOption('indirect');
  // The standard-population picker is replaced by the reference-rate one.
  await expect(page.locator('#epi-standard-label')).toBeHidden();
  await expect(page.locator('#epi-reference-label')).toBeVisible();

  const result = page.locator('#statistics-result');
  // Nothing is computed until the reference column is named.
  await expect(result).toContainText('taxas de referência');

  await page.locator('#statistics-x').selectOption('0'); // events
  await page.locator('#statistics-y').selectOption('1'); // population
  await page.locator('#epi-reference').selectOption('3'); // TXREF, per person
  // Reference rates 0.005 and 0.04 over 1000 and 500 predict 5 + 20 = 25;
  // 30 were observed, so the SMR is 1.2 and its interval still contains 1.
  await expect(result).toContainText('Observados');
  await expect(result).toContainText('30');
  await expect(result).toContainText('Esperados');
  await expect(result).toContainText('25');
  await expect(result).toContainText('1,2');
  await expect(result).toContainText('intervalo contém 1');
});

test('the epidemiology panel refuses fractional events instead of rounding an invented count', async ({ page }) => {
  await page.goto('/');
  await page.locator('#file-input').setInputFiles('e2e/fixtures/epi-fractional-e2e.csv');
  await expect(page.locator('#run-button')).toBeEnabled();

  await page.locator('#row-field').selectOption('FAIXA');
  await page.locator('#measure-kind').selectOption('sum');
  await page.locator('#measure-field').selectOption('EVENTOS');
  await page.locator('summary', { hasText: 'Medidas adicionais' }).click();
  await page.locator('#extra-measure-field').selectOption('POP');
  await page.locator('#extra-measure-add').click();
  await page.locator('#analysis-form').evaluate((form: HTMLFormElement) => form.requestSubmit());

  await page.locator('[data-view="statistics"]').click();
  await page.locator('#statistics-operation').selectOption('epidemiology');
  await page.locator('#statistics-x').selectOption('0');
  await page.locator('#statistics-y').selectOption('1');
  await expect(page.locator('#statistics-result')).toContainText('valor fracionário');
  await expect(page.locator('#statistics-result')).toContainText('0-59');
  await expect(page.locator('#statistics-result')).not.toContainText('Taxa bruta');
});

test('an epidemiology recipe restores method, scale and column bindings by key', async ({ page }) => {
  await page.goto('/');
  await page.locator('#file-input').setInputFiles('e2e/fixtures/epi-e2e.csv');
  await expect(page.locator('#run-button')).toBeEnabled();

  await page.locator('#row-field').selectOption('FAIXA');
  await page.locator('#measure-kind').selectOption('sum');
  await page.locator('#measure-field').selectOption('OBITOS');
  await page.locator('summary', { hasText: 'Medidas adicionais' }).click();
  for (const field of ['POP', 'PADRAO', 'TXREF']) {
    await page.locator('#extra-measure-field').selectOption(field);
    await page.locator('#extra-measure-add').click();
  }
  await page.locator('#analysis-form').evaluate((form: HTMLFormElement) => form.requestSubmit());
  await expect(page.locator('#result-table tbody')).toBeVisible();

  await page.locator('[data-view="statistics"]').click();
  await page.locator('#statistics-operation').selectOption('epidemiology');
  await page.locator('#statistics-x').selectOption('0');
  await page.locator('#statistics-y').selectOption('1');
  await page.locator('#epi-standard').selectOption('2');
  await page.locator('#epi-per').selectOption('1000');
  await page.locator('#epi-method').selectOption('indirect');
  await page.locator('#epi-reference').selectOption('3');
  await expect(page.locator('#statistics-result')).toContainText('SMR');

  const download = page.waitForEvent('download');
  await openSidebarGroup(page, 'saved');
  await page.locator('#save-recipe-button').click();
  const recipeFile = await (await download).path();
  if (!recipeFile) throw new Error('the browser did not expose the saved recipe path');

  // Deliberately move every control away from the saved state. Reopening must
  // bind the semantic column keys again, not reuse these current indices.
  await page.locator('#epi-reference').selectOption('');
  await page.locator('#epi-method').selectOption('direct');
  await page.locator('#epi-per').selectOption('100000');
  await page.locator('#epi-standard').selectOption('');
  await page.locator('#statistics-operation').selectOption('descriptive');

  await page.locator('#recipe-input').setInputFiles(recipeFile);
  await expect(page.locator('#statistics-operation')).toHaveValue('epidemiology');
  await expect(page.locator('#statistics-x')).toHaveValue('0');
  await expect(page.locator('#statistics-y')).toHaveValue('1');
  await expect(page.locator('#epi-method')).toHaveValue('indirect');
  await expect(page.locator('#epi-per')).toHaveValue('1000');
  await expect(page.locator('#epi-standard')).toHaveValue('2');
  await expect(page.locator('#epi-reference')).toHaveValue('3');
  await expect(page.locator('#statistics-result')).toContainText('SMR');
  await expect(page.locator('#statistics-result')).toContainText('1,2');
});

test('statistical and epidemiological bindings follow column keys when columns move', async ({ page }) => {
  await page.goto('/');
  await page.locator('#file-input').setInputFiles('e2e/fixtures/epi-e2e.csv');
  await expect(page.locator('#run-button')).toBeEnabled();
  await page.locator('#row-field').selectOption('FAIXA');
  await page.locator('#measure-kind').selectOption('sum');
  await page.locator('#measure-field').selectOption('OBITOS');
  await page.locator('summary', { hasText: 'Medidas adicionais' }).click();
  for (const field of ['POP', 'PADRAO', 'TXREF']) {
    await page.locator('#extra-measure-field').selectOption(field);
    await page.locator('#extra-measure-add').click();
  }
  await page.locator('#analysis-form').evaluate((form: HTMLFormElement) => form.requestSubmit());

  await page.locator('[data-view="statistics"]').click();
  await page.locator('#statistics-operation').selectOption('epidemiology');
  await page.locator('#statistics-x').selectOption('0');
  await page.locator('#statistics-y').selectOption('1');
  await page.locator('#epi-standard').selectOption('2');
  await page.locator('#epi-method').selectOption('indirect');
  await page.locator('#epi-reference').selectOption('3');

  await page.locator('[data-view="table"]').click();
  const edit = page.locator('#table-edit-column');
  const columnKeys = await edit.locator('option').evaluateAll((options) =>
    options.map((option) => (option as HTMLOptionElement).value));
  const standardKey = columnKeys[2];
  if (!standardKey) throw new Error('PADRAO column was not available to move');
  await edit.selectOption(standardKey);
  await page.locator('#table-column-left').click();
  const referenceKey = columnKeys[3];
  if (!referenceKey) throw new Error('TXREF column was not available to move');
  await edit.selectOption(referenceKey);
  await page.locator('#table-column-left').click();

  // New order is OBITOS, PADRAO, TXREF, POP. Index preservation would silently
  // bind Y/standard/reference to the wrong series; key preservation moves them.
  await page.locator('[data-view="statistics"]').click();
  await expect(page.locator('#statistics-x')).toHaveValue('0');
  await expect(page.locator('#statistics-y')).toHaveValue('3');
  await expect(page.locator('#epi-standard')).toHaveValue('1');
  await expect(page.locator('#epi-reference')).toHaveValue('2');
  await expect(page.locator('#statistics-result')).toContainText('SMR');
});

test('a raw DATASUS file reads as prose, without hiding the technical field name', async ({ page }) => {
  await page.goto('/');
  await page.locator('#file-input').setInputFiles('e2e/fixtures/rotulos-e2e.csv');
  await expect(page.locator('#run-button')).toBeEnabled();

  // No DEF is loaded here: the labels come from the published DATASUS
  // dictionary, and the technical name stays beside each one.
  const rows = page.locator('#row-field');
  await expect(rows).toContainText('Tipo de notificação · TP_NOT');
  await expect(rows).toContainText('Agravo/doença (CID) · ID_AGRAVO');
  await expect(rows).toContainText('Gestante · CS_GESTANT');
  // A label that is only the field name in prettier case is not shown twice.
  await expect(rows).not.toContainText('Sexo · SEXO');

  // The label is presentation only: tabulating by the field still keys on the
  // raw values, and the row header is the technical name.
  await page.locator('#row-field').selectOption('CS_SEXO');
  await page.locator('#analysis-form').evaluate((form: HTMLFormElement) => form.requestSubmit());
  const body = page.locator('#result-table tbody');
  await expect(body).toContainText('F');
  await expect(body).toContainText('M');

  // "Ano 1º Sintoma", which TabNet offers as a row, is derived here rather
  // than shipped: extracting the year from the date makes it a real field.
  await page.locator('summary', { hasText: 'Transformar dados' }).click();
  await page.locator('#transform-step-kind').selectOption('date-part');
  await page.locator('#transform-datepart-field').selectOption('DT_SIN_PRI');
  await page.locator('#transform-datepart-part').selectOption('year');
  await page.locator('#transform-datepart-target').fill('ANO_SIN_PRI');
  await page.locator('#transform-add-step').click();
  await page.locator('#transform-apply-button').click();
  await expect(rows).toContainText('ANO_SIN_PRI');

  await page.locator('#row-field').selectOption('ANO_SIN_PRI');
  await page.locator('#analysis-form').evaluate((form: HTMLFormElement) => form.requestSubmit());
  await expect(body).toContainText('2024');
});

test('several DEFs can be loaded at once, and which one is in force is a visible choice', async ({ page }) => {
  await page.goto('/');
  // The picker only exists once there is something to pick.
  await expect(page.locator('#def-picker')).toBeHidden();
  await openSidebarGroup(page, 'metadata');
  await expect(page.locator('#def-inspector-button')).toBeDisabled();

  await page.locator('#file-input').setInputFiles([
    'e2e/fixtures/def-dados-e2e.csv',
    'e2e/fixtures/casos-e2e.def',
    'e2e/fixtures/obitos-e2e.def',
  ]);
  await expect(page.locator('#def-picker')).toBeVisible();

  // Both DEFs are held; loading the second no longer overwrites the first.
  const picker = page.locator('#def-active');
  await expect(picker).toContainText('casos-e2e.def');
  await expect(picker).toContainText('obitos-e2e.def');

  // The active DEF names the measure: this is the difference between TabNet's
  // "Casos confirmados" and the bare "Freqüência" a raw file gets.
  await picker.selectOption('casos-e2e.def');
  await expect(page.locator('#def-active-note')).toContainText('Casos confirmados por local');
  await expect(page.locator('#measure-field')).toContainText('Casos confirmados');

  // Switching DEF re-labels the same underlying field.
  await picker.selectOption('obitos-e2e.def');
  await expect(page.locator('#def-active-note')).toContainText('Obitos por local');
  await expect(page.locator('#measure-field')).toContainText('Obitos registrados');

  // "Sem DEF" is a real choice, not just an absence: it puts the technical
  // names back and disables the inspector.
  await picker.selectOption('');
  await expect(page.locator('#def-active-note')).toContainText('nomes técnicos');
  await openSidebarGroup(page, 'metadata');
  await expect(page.locator('#def-inspector-button')).toBeDisabled();
  await expect(page.locator('#measure-field')).not.toContainText('Casos confirmados');
  await expect(page.locator('#measure-field')).toContainText('CASOS');
});

test('a saved recipe replays its transform pipeline, so it rebuilds the same table it saved', async ({ page }) => {
  // The pipeline runs before the tabulation. A recipe that carried only the
  // plan would replay it over the untransformed file and rebuild a different
  // table - while its own source fingerprints asserted the file matched.
  await page.goto('/');
  await page.locator('#file-input').setInputFiles('e2e/fixtures/limpeza-e2e.csv');
  await expect(page.locator('#run-button')).toBeEnabled();

  await page.locator('summary', { hasText: 'Transformar dados' }).click();
  await page.locator('#transform-step-kind').selectOption('date-part');
  await page.locator('#transform-datepart-field').selectOption('DT');
  await page.locator('#transform-datepart-part').selectOption('year');
  await page.locator('#transform-datepart-target').fill('ANO');
  await page.locator('#transform-add-step').click();
  await page.locator('#transform-apply-button').click();

  // ANO exists only because the pipeline created it.
  await expect(page.locator('#row-field')).toContainText('ANO');
  await page.locator('#row-field').selectOption('ANO');
  await page.locator('#analysis-form').evaluate((form: HTMLFormElement) => form.requestSubmit());
  const body = page.locator('#result-table tbody');
  await expect(body).toContainText('2024');
  const savedTable = await body.innerText();

  const download = page.waitForEvent('download');
  await openSidebarGroup(page, 'saved');
  await page.locator('#save-recipe-button').click();
  const recipeFile = await (await download).path();

  // Fresh session, same raw file: ANO does not exist yet.
  await page.goto('/');
  await page.locator('#file-input').setInputFiles('e2e/fixtures/limpeza-e2e.csv');
  await expect(page.locator('#run-button')).toBeEnabled();
  await expect(page.locator('#row-field')).not.toContainText('ANO');

  await page.locator('#recipe-input').setInputFiles(recipeFile!);
  // Opening the recipe replays the pipeline first, so the field it needs
  // exists and the rebuilt table is the one that was saved.
  await expect(page.locator('#transform-count')).toContainText('1 etapa');
  await expect(page.locator('#result-table tbody')).toContainText('2024');
  expect(await page.locator('#result-table tbody').innerText()).toBe(savedTable);
});

test('as ações em lote agem sobre a escolha, e "todos" continua a um clique', async ({ page }) => {
  // O catálogo é simulado: o objetivo aqui é a seleção, não a rede. Sem isso a
  // barra de lote só existiria em produção, onde ninguém a testa.
  await page.route('https://datasus.saude.gov.br/wp-content/ftp.php', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: { 'access-control-allow-origin': '*' },
      body: JSON.stringify([2021, 2022, 2023].map((year) => ({
        arquivo: `DENGBR${String(year).slice(2)}.dbc`,
        endereco: `ftp://ftp.datasus.gov.br/dissemin/publicos/SINAN/DADOS/FINAIS/DENGBR${String(year).slice(2)}.dbc`,
        fonte: 'SINAN',
        modalidade: 'Dados - Finais',
      }))),
    });
  });

  await page.goto('/');
  await page.locator('#catalog-button').click();
  await page.locator('#catalog-system').selectOption('SINAN');
  await page.locator('#catalog-file-type').selectOption('DENG');

  // "todos" nos anos: um clique cobre quem quer a série inteira.
  const years = page.locator('#catalog-year');
  const yearsAll = page.locator('#catalog-year-all');
  await expect(yearsAll).toHaveText('todos');
  await yearsAll.click();
  await expect(yearsAll).toHaveText('limpar');
  const selectedYears = await years.evaluate((el: HTMLSelectElement) => el.selectedOptions.length);
  expect(selectedYears).toBeGreaterThan(1);
  // O botão não pode mentir sobre o que o próximo clique faz.
  await yearsAll.click();
  await expect(yearsAll).toHaveText('todos');
  await years.selectOption(['2023', '2022', '2021']);

  await page.locator('#catalog-form').evaluate((form: HTMLFormElement) => form.requestSubmit());

  const bar = page.locator('.catalog-batch-bar');
  await expect(bar).toBeVisible();
  // Tudo marcado por padrão: quem quer o lote inteiro não precisa clicar em nada.
  await expect(bar).toContainText('3 de 3 selecionado(s)');
  await expect(page.locator('.catalog-batch-bar-actions button').first()).toContainText('(3)');
  await expect(page.locator('.catalog-batch-bar-actions button').nth(1)).toContainText('.zip (3)');

  // Desmarcar um arquivo tem que refletir nas duas ações, não só na contagem.
  await page.locator('.catalog-result-check').first().uncheck();
  await expect(bar).toContainText('2 de 3 selecionado(s)');
  await expect(page.locator('.catalog-batch-bar-actions button').first()).toContainText('(2)');
  await expect(page.locator('.catalog-batch-bar-actions button').nth(1)).toContainText('.zip (2)');

  // Sem nada escolhido, as ações em lote ficam indisponíveis em vez de rodar vazias.
  for (const box of await page.locator('.catalog-result-check').all()) await box.uncheck();
  await expect(bar).toContainText('0 de 3 selecionado(s)');
  await expect(page.locator('.catalog-batch-bar-actions button').first()).toBeDisabled();
  await expect(page.locator('.catalog-batch-bar-actions button').nth(1)).toBeDisabled();

  // E o "selecionar todos" da barra devolve o lote inteiro num clique.
  await bar.locator('.select-all-button').click();
  await expect(bar).toContainText('3 de 3 selecionado(s)');
  await expect(page.locator('.catalog-batch-bar-actions button').first()).toBeEnabled();
});

test('o downloader local é oferecido, nunca iniciado sozinho, e só depois de verificar', async ({ page }) => {
  // Uma página não pode executar programa na máquina de ninguém. O que se
  // prova aqui é justamente o que o aplicativo NÃO faz por conta própria.
  let probes = 0;
  await page.route('http://127.0.0.1:8787/health', async (route) => {
    probes++;
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: { 'access-control-allow-origin': '*' },
      body: JSON.stringify({
        service: 'tabwin-bridge',
        protocol: 1,
        allowlist: ['https://ftp.datasus.gov.br/dissemin/publicos/… — árvore pública'],
        directory: 'C:/Users/x/Downloads/TabWin',
      }),
    });
  });

  await page.goto('/');
  await page.locator('#catalog-button').click();

  // Abrir o catálogo não pode sondar a máquina: um site que varre portas ao
  // carregar é exatamente o que não queremos ser.
  await page.waitForTimeout(600);
  expect(probes).toBe(0);

  await page.locator('#bridge-panel summary').click();
  const verdict = page.locator('#bridge-verdict');
  await expect(verdict).toBeHidden();

  // Verificar sem token detecta o auxiliar, mas não o dá por pronto.
  await page.locator('#bridge-check').click();
  await expect(verdict).toBeVisible();
  await expect(verdict).toContainText('falta colar o token');
  expect(probes).toBe(1);

  // Com token, ele fica disponível e a allowlist aparece para o usuário ler.
  await page.locator('#bridge-token').fill('token-de-teste');
  await page.locator('#bridge-check').click();
  await expect(verdict).toContainText('Downloader local disponível');
  await expect(verdict).toContainText('ftp.datasus.gov.br');
  await expect(verdict).toHaveClass(/bridge-verdict-ok/);
});

test('auxiliar de versão incompatível é recusado em vez de tentar adivinhar', async ({ page }) => {
  await page.route('http://127.0.0.1:8787/health', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: { 'access-control-allow-origin': '*' },
      body: JSON.stringify({ service: 'tabwin-bridge', protocol: 99, allowlist: [], directory: 'x' }),
    });
  });
  await page.goto('/');
  await page.locator('#catalog-button').click();
  await page.locator('#bridge-panel summary').click();
  await page.locator('#bridge-token').fill('token-de-teste');
  await page.locator('#bridge-check').click();
  const verdict = page.locator('#bridge-verdict');
  await expect(verdict).toContainText('incompatível');
  await expect(verdict).toHaveClass(/bridge-verdict-warn/);
});

test('o pacote para o Lab sai com os dados e a procedência junto', async ({ page }) => {
  await tabulateFixture(page);
  await openSidebarGroup(page, 'export');

  const download = page.waitForEvent('download');
  await page.locator('#lab-package-button').click();
  const file = await download;
  expect(file.suggestedFilename()).toMatch(/^tabwin-lab-tabela-\d{4}-\d{2}-\d{2}\.zip$/);

  // O ponto do pacote é não ser um CSV solto: sem procedência, meses depois
  // ninguém sabe qual arquivo gerou aquilo nem que filtros estavam ativos.
  const path = await file.path();
  const { readFileSync } = await import('node:fs');
  const { unzipSync, strFromU8 } = await import('fflate');
  const entries = unzipSync(new Uint8Array(readFileSync(path)));
  expect(Object.keys(entries).sort()).toEqual(['PROVENIENCIA.json', 'dados.csv']);

  const provenance = JSON.parse(strFromU8(entries['PROVENIENCIA.json']));
  expect(provenance.schema).toBe('tabwin-web.lab-package');
  expect(provenance.content).toBe('tabulation');
  expect(provenance.rowCount).toBeGreaterThan(0);
  expect(provenance.notes.join(' ')).toMatch(/Nenhum zero foi fabricado/);

  // O BOM se afere nos BYTES: o decodificador de texto o consome, então
  // checar a string sempre passaria por engano.
  expect([...entries['dados.csv'].slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
  const csv = strFromU8(entries['dados.csv']);
  expect(csv.split('\r\n').length - 1).toBe(provenance.rowCount + 1);
});

test('o arquivo guardado pode ser baixado sem precisar abrir a análise', async ({ page }) => {
  // Querer o arquivo é diferente de querer analisá-lo aqui. Antes, a única
  // forma de tirá-lo do aparelho era abrir a análise primeiro.
  await page.route('https://datasus.saude.gov.br/wp-content/ftp.php', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: { 'access-control-allow-origin': '*' },
      body: '[]',
    });
  });
  await page.goto('/');

  // O zip é montado aqui e entregue como bytes: o navegador de teste não tem
  // como importar fflate da árvore de node_modules.
  const { zipSync, strToU8 } = await import('fflate');
  const archive = [...zipSync({ 'GUARDADO01.dbc': strToU8('conteudo-de-teste') })];

  await page.evaluate(async (bytes) => {
    const open = indexedDB.open('tabwin-web', 1);
    const database: IDBDatabase = await new Promise((resolve, reject) => {
      open.onsuccess = () => resolve(open.result);
      open.onerror = () => reject(open.error);
      open.onupgradeneeded = () => {
        if (!open.result.objectStoreNames.contains('official-archives')) {
          // O indice tem que existir aqui tambem: o aplicativo o cria e a
          // eviction depende dele. Uma store de teste sem indice fabricava um
          // estado que nenhum usuario tem.
          const store = open.result.createObjectStore('official-archives', { keyPath: 'key' });
          store.createIndex('savedAt', 'savedAt');
        }
      };
    });
    const transaction = database.transaction('official-archives', 'readwrite');
    transaction.objectStore('official-archives').put({
      key: 'official-v1:teste',
      savedAt: Date.now(),
      bytes: new Uint8Array(bytes).buffer,
      sha256: 'a'.repeat(64),
      role: 'data',
      sources: [{ name: 'GUARDADO01.dbc', address: 'ftp://ftp.datasus.gov.br/x', source: 'SINAN', modality: 'Dados' }],
    });
    await new Promise((resolve) => { transaction.oncomplete = () => resolve(null); });
  }, archive);

  await page.locator('#catalog-button').click();
  const row = page.locator('.catalog-recent-item').filter({ hasText: 'GUARDADO01.dbc' });
  await expect(row).toBeVisible();

  const download = page.waitForEvent('download');
  await row.getByRole('button', { name: 'Baixar' }).click();
  const file = await download;
  // Sai o DBC que a pessoa reconhece, não o .zip como veio da rede.
  expect(file.suggestedFilename()).toBe('GUARDADO01.dbc');
});

test('um .TAB salvo pelo TabWin 4.15 abre aqui, somente para leitura', async ({ page }) => {
  // O leitor era provado contra o golden G023 e não estava ligado: a
  // biblioteca lia o formato, o aplicativo não abria o arquivo. Esta fixture é
  // o próprio golden — o .TAB que o TabWin gravou.
  await page.goto('/');
  await openSidebarGroup(page, 'saved');
  await page.locator('#table-input').setInputFiles('e2e/fixtures/tabwin-legado.tab');

  const body = page.locator('#result-table tbody');
  await expect(body).toContainText('Média complexidade');
  await expect(body).toContainText('1.968');
  await expect(body).toContainText('Alta complexidade');

  // O título vem do próprio arquivo, não é inventado.
  await expect(page.locator('#result-title')).toContainText('Complexidade do Procedimento');
  // E a procedência que o arquivo declara é mostrada sem tradução.
  const origin = page.locator('#legacy-tab-origin');
  await expect(origin).toBeVisible();
  await expect(origin).toContainText('RD2008.DEF');
  await expect(origin).toContainText('Não_Classificados');

  // É leitura, não reexecução: sem microdados, não há o que salvar como receita.
  await expect(page.locator('#save-recipe-button')).toBeDisabled();
  await expect(page.locator('#save-table-button')).toBeEnabled();
});


test('a busca mostra o que já achou, sem esperar o lote inteiro', async ({ page }) => {
  // O defeito relatado: com muitas combinações num servidor lento, os arquivos
  // "só apareciam quando você cancelava" — porque cancelar era a única forma de
  // o lote devolver o parcial. Quem via isso concluía que a busca não
  // funcionava, e desistia.
  let respondidas = 0;
  // O padrão precisa casar com os ENDPOINTS, não com qualquer URL que contenha
  // "catalog". Em desenvolvimento o Vite serve cada módulo pelo caminho, e um
  // regex solto passou a interceptar `src/catalog-memory-store.ts` — a busca
  // recebia JSON no lugar de JavaScript e o app nem carregava.
  await page.route(/\/catalog(\?|$)|wp-content\/ftp\.php/, async (route) => {
    respondidas++;
    // A primeira responde na hora; as seguintes demoram, como o DATASUS ruim.
    if (respondidas > 1) await new Promise((resolve) => setTimeout(resolve, 4000));
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: { 'access-control-allow-origin': '*' },
      body: JSON.stringify([{
        arquivo: `ACHADO${respondidas}.dbc`,
        endereco: 'ftp://ftp.datasus.gov.br/dissemin/publicos/SINAN/DADOS/FINAIS/X.dbc',
        fonte: 'SINAN',
        modalidade: 'Dados - Finais',
      }]),
    });
  });

  await page.goto('/');
  await page.locator('#catalog-button').click();
  await page.locator('#catalog-system').selectOption('SINAN');
  await page.locator('#catalog-file-type').selectOption('DENG');
  await page.locator('#catalog-year').selectOption(['2024', '2023', '2022', '2021']);
  await page.locator('#catalog-form').evaluate((form: HTMLFormElement) => form.requestSubmit());

  // Enquanto o lote ainda roda, a tela já diz o que encontrou até agora.
  const parcial = page.locator('#catalog-results').getByText(/encontrado\(s\) até agora/);
  await expect(parcial).toBeVisible({ timeout: 8000 });
  await expect(parcial).toContainText('de 4');

  // E ninguém precisou cancelar para ver.
  await expect(page.locator('#catalog-cancel-button')).toBeEnabled();
});

test('aconselha o arquivo nacional quando várias UFs foram marcadas', async ({ page }) => {
  // O caso que custou vinte minutos de espera: no SINASC, "todas as UFs" em
  // vários anos são centenas de downloads quando o arquivo nacional do mesmo
  // ano já traz as 27 — e a UF vira um filtro depois de abrir. A dica já
  // existia na tela, mas só aparecia para quem já tinha escolhido o nacional.
  await page.goto('/');
  await page.locator('#catalog-button').click();
  await page.locator('#catalog-system').selectOption('SINASC');
  await page.locator('#catalog-file-type').selectOption('DN');

  const conselho = page.locator('#catalog-national-advice');
  await page.locator('#catalog-year').selectOption(['2022', '2021']);

  // Duas UFs ainda podem ser deliberadas e baratas: aviso que aparece sempre
  // vira ruído e some da atenção junto com os que importam.
  await page.locator('#catalog-uf').selectOption(['SP', 'RJ']);
  await expect(conselho).toBeHidden();

  await page.locator('#catalog-uf').selectOption(['SP', 'RJ', 'MG', 'BA']);
  await expect(conselho).toBeVisible();
  await expect(conselho).toContainText('4 UFs');
  await expect(conselho).toContainText('2 download(s) em vez de 8');

  // E resolver o conselho é um clique, não uma lição de casa.
  await page.locator('#catalog-use-national').click();
  await expect(page.locator('#catalog-uf')).toHaveValue('BR');
  await expect(conselho).toBeHidden();
  // Os anos escolhidos continuam de pé: o botão troca a geografia, nada mais.
  const anos = await page.locator('#catalog-year').evaluate(
    (el: HTMLSelectElement) => [...el.selectedOptions].map((option) => option.value));
  expect(anos).toEqual(['2022', '2021']);
});

test('uma seleção enorme pede confirmação antes de começar a espera', async ({ page }) => {
  // Uma busca de centenas de combinações pode ser exatamente o que a pessoa
  // quer. O que não pode é a espera começar sem ela ter visto o tamanho.
  let consultas = 0;
  await page.route('**/wp-content/ftp.php', async (route) => {
    consultas += 1;
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: { 'access-control-allow-origin': '*' },
      body: '[]',
    });
  });

  await page.goto('/');
  await page.locator('#catalog-button').click();
  await page.locator('#catalog-system').selectOption('SINASC');
  await page.locator('#catalog-file-type').selectOption('DN');
  // Oito anos por 28 opções de geografia passam do limite de 200 sem precisar
  // de mil requisições falsas para provar o ponto.
  await page.locator('#catalog-year').selectOption(
    ['2024', '2023', '2022', '2021', '2020', '2019', '2018', '2017']);
  await page.locator('#catalog-uf-all').click();

  // O resumo diz o tamanho antes mesmo de clicar em procurar.
  await expect(page.locator('#catalog-capabilities')).toContainText('só para consultar');

  const perguntas: string[] = [];
  // Registrar um ouvinte desliga a recusa automática do Playwright: quem escuta
  // precisa responder, senão o diálogo fica aberto e trava a página.
  page.on('dialog', (dialog) => { perguntas.push(dialog.message()); void dialog.dismiss(); });
  await page.locator('#catalog-form').evaluate((form: HTMLFormElement) => form.requestSubmit());

  await expect(page.locator('#catalog-status')).toContainText('Busca não iniciada');
  expect(perguntas.join('\n')).toMatch(/combinação\(ões\)/);
  // E recusar significa recusar: nenhuma ida ao servidor foi disparada.
  expect(consultas).toBe(0);

  // Confirmar também precisa funcionar: a seleção grande pode ser exatamente a
  // série que a pessoa quer, e o aviso não pode virar um bloqueio.
  //
  // A seleção muda de propósito. Repetir a anterior seria servido da memória
  // do catálogo, e o teste passaria a medir o cache em vez da confirmação.
  await page.locator('#catalog-year').selectOption(
    ['2016', '2015', '2014', '2013', '2012', '2011', '2010', '2009']);
  page.removeAllListeners('dialog');
  page.on('dialog', (dialog) => { void dialog.accept(); });
  await page.locator('#catalog-form').evaluate((form: HTMLFormElement) => form.requestSubmit());
  // Espera ativa: a submissão passa por uma leitura assíncrona da memória
  // antes de tocar a rede, e conferir na hora media a corrida, não o efeito.
  await expect.poll(() => consultas, { timeout: 60_000 }).toBeGreaterThan(0);
});

test('o .dbc pode ser salvo direto do resultado da busca, sem abrir', async ({ page }) => {
  // "Baixar e abrir" serve para tabular aqui. Quem vai levar o arquivo para o
  // R, para o Python ou para outra máquina não precisa que o navegador monte
  // uma tabulação antes — e num arquivo de 120 MB essa etapa é a que pesa.
  const { zipSync, strToU8 } = await import('fflate');
  const pacote = Buffer.from(zipSync({ 'DNBR1997.dbc': strToU8('microdado-de-teste') }, { level: 0 }));

  await page.route('**/wp-content/ftp.php', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    headers: { 'access-control-allow-origin': '*' },
    body: JSON.stringify([{
      arquivo: 'DNBR1997.dbc',
      endereco: 'ftp://ftp.datasus.gov.br/dissemin/publicos/SINASC/NOV/DNRES/DNBR1997.dbc',
      fonte: 'SINASC',
      modalidade: 'Dados',
    }]),
  }));
  await page.route('**/wp-content/download.php', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    headers: { 'access-control-allow-origin': '*' },
    // A resposta real é um ARRAY de strings; um objeto passa despercebido pelo
    // coletor e o download nem chega a começar.
    body: JSON.stringify(['https://datasus.saude.gov.br/wp-content/zipupload/Arq_1/arquivo.zip']),
  }));
  await page.route('**/zipupload/**', (route) => route.fulfill({
    status: 200,
    contentType: 'application/zip',
    headers: { 'access-control-allow-origin': '*', 'accept-ranges': 'none' },
    body: pacote,
  }));

  await page.goto('/');
  await page.locator('#catalog-button').click();
  await page.locator('#catalog-system').selectOption('SINASC');
  await page.locator('#catalog-file-type').selectOption('DN');
  await page.locator('#catalog-year').selectOption(['1997']);
  await page.locator('#catalog-form').evaluate((form: HTMLFormElement) => form.requestSubmit());

  const salvar = page.getByRole('button', { name: 'Salvar .dbc' });
  await expect(salvar).toBeVisible();
  const baixando = page.waitForEvent('download');
  await salvar.click();
  const arquivo = await baixando;
  // Sai o .dbc de dentro do pacote, não o .zip como veio da rede.
  expect(arquivo.suggestedFilename()).toBe('DNBR1997.dbc');

  // E nenhuma tabulação foi montada: salvar não é abrir.
  await expect(page.locator('#result-table tbody tr')).toHaveCount(0);
});

test('a segunda busca não repete as viagens que já foram respondidas', async ({ page }) => {
  // No caso real, 48 combinações para trazer 30 arquivos: 17 viagens completas
  // ao servidor existiram só para descobrir que um arquivo de 1981 não foi
  // publicado. E na busca seguinte tudo se repetia.
  let consultas = 0;
  await page.route('**/wp-content/ftp.php', async (route) => {
    consultas += 1;
    const corpo = route.request().postData() ?? '';
    // Só 1996 existe; os demais anos respondem vazio, como o DATASUS faz.
    const existe = corpo.includes('1996');
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: { 'access-control-allow-origin': '*' },
      body: existe
        ? JSON.stringify([{
          arquivo: 'DNBR1996.dbc',
          endereco: 'ftp://ftp.datasus.gov.br/dissemin/publicos/SINASC/NOV/DNRES/DNBR1996.dbc',
          fonte: 'SINASC',
          modalidade: 'Dados',
        }])
        : '[]',
    });
  });

  await page.goto('/');
  await page.locator('#catalog-button').click();
  await page.locator('#catalog-system').selectOption('SINASC');
  await page.locator('#catalog-file-type').selectOption('DN');
  const anos = ['1996', '1997', '1998', '1999'];
  await page.locator('#catalog-year').selectOption(anos);
  await page.locator('#catalog-form').evaluate((form: HTMLFormElement) => form.requestSubmit());
  await expect(page.locator('#catalog-results')).toContainText('DNBR1996.dbc');

  const primeira = consultas;
  expect(primeira).toBe(anos.length);

  // Segunda busca idêntica: nada precisa ir ao servidor de novo.
  await page.locator('#catalog-form').evaluate((form: HTMLFormElement) => form.requestSubmit());
  await expect(page.locator('#catalog-results')).toContainText('vieram de consultas anteriores');
  expect(consultas).toBe(primeira);
  // O arquivo encontrado continua listado, vindo da memória.
  await expect(page.locator('#catalog-results')).toContainText('DNBR1996.dbc');

  // E "Consultar de novo" ignora o que está guardado, como promete.
  await page.getByRole('button', { name: 'Consultar de novo' }).click();
  await expect(page.locator('#catalog-results')).toContainText('DNBR1996.dbc');
  expect(consultas).toBe(primeira * 2);
});

test('a lista de combinações aparece antes das respostas, e cada linha se resolve', async ({ page }) => {
  // Quem quer o arquivo de 1996 não deveria esperar 2026, 2025 e 2024
  // responderem para saber que ele existe.
  let liberar;
  const segura = new Promise((resolve) => { liberar = resolve; });
  await page.route(/\/catalog(\?|$)|wp-content\/ftp\.php/, async (route) => {
    const corpo = route.request().postData() ?? '';
    // 1996 responde na hora; os demais só depois que o teste mandar.
    if (!corpo.includes('1996')) await segura;
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: { 'access-control-allow-origin': '*' },
      body: corpo.includes('1996')
        ? JSON.stringify([{
          arquivo: 'DNBR1996.dbc',
          endereco: 'ftp://ftp.datasus.gov.br/x/DNBR1996.dbc',
          fonte: 'SINASC',
          modalidade: 'Dados',
        }])
        : '[]',
    });
  });

  await page.goto('/');
  await page.locator('#catalog-button').click();
  await page.locator('#catalog-system').selectOption('SINASC');
  await page.locator('#catalog-file-type').selectOption('DN');
  await page.locator('#catalog-year').selectOption(['1996', '1997', '1998', '1999']);
  await page.locator('#catalog-form').evaluate((form: HTMLFormElement) => form.requestSubmit());

  // As quatro linhas existem antes de qualquer resposta.
  const linhas = page.locator('.catalog-pending-row');
  await expect(linhas).toHaveCount(4);
  // E a de 1996 já se resolveu, com as outras ainda pendentes.
  await expect(page.locator('.catalog-pending-row.achou')).toContainText('DNBR1996.dbc');
  await expect(page.locator('.catalog-pending-row').filter({ hasText: 'verificando' }))
    .toHaveCount(3);

  liberar();
  await expect(page.locator('#catalog-results')).toContainText('DNBR1996.dbc');
  // A lista provisória sai quando o resultado definitivo entra.
  await expect(linhas).toHaveCount(0);
});

test('o cache guarda os seis mais recentes e descarta os antigos sem carregá-los', async ({ page }) => {
  // A eviction nunca teve teste, e o código que ela substitui usava `getAll()`
  // — trazia os BYTES de todo pacote em cache só para ordenar por data, logo
  // depois de o navegador já ter na memória o arquivo recém-baixado.
  const { zipSync, strToU8 } = await import('fflate');
  await page.route('**/wp-content/ftp.php', (route) => route.fulfill({
    status: 200, contentType: 'application/json',
    headers: { 'access-control-allow-origin': '*' }, body: '[]',
  }));
  await page.goto('/');

  const pacote = [...zipSync({ 'X.dbc': strToU8('conteudo') })];
  // Oito pacotes com datas crescentes; o limite do aplicativo é seis.
  const resultado = await page.evaluate(async (bytes) => {
    const mod = await import('/src/archive-cache.ts');
    for (let i = 1; i <= 8; i++) {
      await mod.writeCachedArchive(`official-v1:pacote-${i}`, new Uint8Array(bytes), {
        sha256: String(i).repeat(64).slice(0, 64),
        role: 'data',
        sources: [{ name: `P${i}.dbc`, address: 'ftp://x', source: 'SINAN', modality: 'Dados' }],
      });
      // Datas distintas: escritos no mesmo milissegundo empatariam a ordenação.
      await new Promise((r) => setTimeout(r, 4));
    }
    const guardados = await mod.listCachedArchives();
    return guardados.map((s) => s.key);
  }, pacote);

  expect(resultado).toHaveLength(6);
  // Os dois mais antigos saíram; os seis mais novos ficaram, do novo para o velho.
  expect(resultado).toEqual([
    'official-v1:pacote-8', 'official-v1:pacote-7', 'official-v1:pacote-6',
    'official-v1:pacote-5', 'official-v1:pacote-4', 'official-v1:pacote-3',
  ]);
});

test('a consulta SQL responde sobre os dados abertos, sem tocar no motor de tabulação', async ({ page }) => {
  // O DuckDB é superfície de ANÁLISE. A tabela do TabWin continua saindo do
  // executor de referência; aqui é para perguntas que o plano não expressa.
  test.setTimeout(180_000);
  const erros: string[] = [];
  page.on('pageerror', (e) => erros.push(String(e)));
  await page.goto('/');
  await page.locator('#file-input').setInputFiles('e2e/fixtures/microdados-e2e.csv');
  await expect(page.locator('#result-table tbody tr').first()).toBeVisible();

  await page.getByRole('button', { name: 'Consulta' }).click();
  // Ao abrir um arquivo a aba já diz quais campos existem e se cabem, antes de
  // qualquer carga. Um limite descoberto depois de materializar centenas de
  // milhares de linhas seria descoberto tarde demais.
  await expect(page.locator('#query-status')).toContainText('campo(s) disponíveis');
  await expect(page.locator('#query-fields option')).toHaveCount(3);
  await expect(page.locator('#query-fields option:checked')).toHaveCount(3);
  // Executar tem que estar desligado enquanto não há tabela.
  await expect(page.locator('#query-run')).toBeDisabled();

  await page.getByRole('button', { name: 'Carregar os dados abertos' }).click();
  // O motor são ~7 MB de WebAssembly; a primeira carga leva tempo de verdade.
  await expect(page.locator('#query-status')).toContainText('pronta com', { timeout: 150_000 });
  await expect(page.locator('#query-run')).toBeEnabled();

  // O nome da tabela sai do nome do arquivo normalizado; ler do status evita
  // o teste adivinhar e falhar por um hifen virar sublinhado.
  const status = await page.locator('#query-status').textContent();
  // Segunda palavra do status: "Tabela <nome> pronta com …". Sem regex de
  // propósito — o nome do arquivo é normalizado (hífen vira sublinhado) e
  // adivinhá-lo no teste já falhou uma vez.
  const tabela = (status ?? '').split(' ')[1];
  expect(tabela).toBeTruthy();
  await page.locator('#query-sql').fill(`SELECT COUNT(*) AS total FROM "${tabela}"`);
  await page.locator('#query-run').click();
  await expect(page.locator('#query-result')).toContainText('total');
  await expect(page.locator('#query-status')).toContainText('linha(s) em');
  expect(erros.join(' | ')).toBe('');
});
