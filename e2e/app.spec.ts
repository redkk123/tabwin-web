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
  await expect(page.locator('#microdatasus-csv-button')).toBeEnabled();

  const download = page.waitForEvent('download');
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
  await page.locator('#save-table-button').click();
  const tableBFile = await (await saveDownload).path();

  // Now load table A - AC=2, AM=1 - into the live session. B (AC=3, SP=1)
  // only ever exists as the file just saved.
  await page.locator('#file-input').setInputFiles('e2e/fixtures/compare-a-e2e.csv');
  await expect(page.locator('#run-button')).toBeEnabled();
  await page.locator('#row-field').selectOption('UF');
  await page.locator('#analysis-form').evaluate((form: HTMLFormElement) => form.requestSubmit());
  await expect(page.locator('#result-table tbody')).toContainText('AC');

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
