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
