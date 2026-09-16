import { test, expect } from '@playwright/test';

// ═══════════════════════════════════════════════════════════════════════════════
// PLAYWRIGHT E2E TESTS — KIRAA UI + API
// Base URL: http://localhost:3000 (set in playwright.config.ts)
// ═══════════════════════════════════════════════════════════════════════════════

test.describe('API Healthcheck', () => {
  test('GET /api/health returns 200 and status ok', async ({ request }) => {
    const response = await request.get('/api/health');
    expect(response.status()).toBe(200);
    const body = await response.json();
    expect(body.status).toBe('ok');
  });
});

test.describe('Page principale', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
  });

  test('H1 est visible et contient KIRAA', async ({ page }) => {
    const h1 = page.locator('h1');
    await expect(h1).toBeVisible();
    const text = await h1.textContent();
    expect(text?.toLowerCase()).toContain('kiraa');
  });

  test("Champ de saisie de message présent", async ({ page }) => {
    const input = page.getByRole('textbox');
    await expect(input).toBeVisible();
  });

  test("Bouton d'envoi présent et cliquable", async ({ page }) => {
    const btn = page.getByRole('button', { name: /envoyer|send/i });
    await expect(btn).toBeVisible();
  });
});

test.describe('Chat flow — conducteur éligible', () => {
  test('Envoyer une demande de location et recevoir une réponse', async ({ page }) => {
    await page.goto('/');

    const input = page.getByRole('textbox');
    await input.fill("Bonjour, j'ai 28 ans, permis depuis 5 ans. Je veux louer un SUV 3 jours. Assurance basique.");
    await page.keyboard.press('Enter');

    // Attendre la réponse de l'agent (max 30 s)
    const agentReply = page.locator('[data-testid="agent-message"]').first();
    await expect(agentReply).toBeVisible({ timeout: 30000 });

    const replyText = await agentReply.textContent();
    // La réponse doit contenir au moins un montant financier (MAD)
    expect(replyText).toMatch(/MAD|Total|caution/i);
  });
});

test.describe('Chat flow — conducteur inéligible', () => {
  test('Conducteur mineur → message de rejet sans montant', async ({ page }) => {
    await page.goto('/');

    const input = page.getByRole('textbox');
    await input.fill("Bonjour j'ai 18 ans et je veux louer une voiture.");
    await page.keyboard.press('Enter');

    const agentReply = page.locator('[data-testid="agent-message"]').first();
    await expect(agentReply).toBeVisible({ timeout: 30000 });

    const replyText = await agentReply.textContent();
    expect(replyText).toMatch(/inéligible|mineur|21 ans|refus/i);
    // Pas de montant Total à Payer affiché pour un rejet
    expect(replyText).not.toMatch(/Total à payer/i);
  });
});
