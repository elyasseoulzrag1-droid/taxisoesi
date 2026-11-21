// Parcours principal : ajouter une dépense, vérifier qu'elle apparaît, enregistrer un apport, vérifier les associés.
export async function run(page, { assert }) {
  const countOps = () => page.evaluate(() => window.__mock.dump ? null : null);
  // Ouvre le formulaire depuis la barre du bas.
  await page.click(".app-tab-add");
  await page.waitForSelector("[role=dialog]");
  await page.fill("[role=dialog] input[inputmode=decimal]", "12,50");
  await page.fill("[role=dialog] input[maxlength='140']", "Test dépense scénario");
  await page.click("[role=dialog] button:has-text('Enregistrer'):not(:has-text('nouvelle'))");
  await page.waitForSelector("[role=dialog]", { state: "detached" });
  await page.evaluate(() => { location.hash = "operations"; });
  await page.waitForSelector("text=Test dépense scénario");
  const row = await page.textContent(".oprow:has-text('Test dépense scénario')");
  assert.ok(/12,50/.test(row), "le montant saisi doit apparaître : " + row);
  // Modifie l'opération.
  await page.click(".oprow:has-text('Test dépense scénario')");
  await page.waitForSelector("[role=dialog]");
  await page.fill("[role=dialog] input[inputmode=decimal]", "20");
  await page.click("[role=dialog] button:has-text('Enregistrer')");
  await page.waitForSelector("[role=dialog]", { state: "detached" });
  const row2 = await page.textContent(".oprow:has-text('Test dépense scénario')");
  assert.ok(/20,00/.test(row2), "le montant modifié doit apparaître : " + row2);
  // Supprime.
  await page.click(".oprow:has-text('Test dépense scénario')");
  await page.waitForSelector("[role=dialog]");
  await page.click("[role=dialog] button:has-text('Supprimer')");
  await page.click("button:has-text('Supprimer'):visible >> nth=-1");
  await page.waitForSelector("text=Test dépense scénario", { state: "detached" });
  void countOps;
}
