/**
 * Test 10 prompts Kiraa Agent — avec délai inter-test pour éviter rate limit TPM
 */
import * as dotenv from "dotenv";
import * as fs from "fs";
import * as path from "path";
dotenv.config({ path: ".env.local" });

import { createAgentGraph } from "../src/agent/graph.js";
import { HumanMessage } from "@langchain/core/messages";

const graph = createAgentGraph();

interface TestResult {
  id: number; scenario: string; prompt: string;
  passed: boolean; response: string; checks: { label: string; ok: boolean }[];
}

async function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

async function runPrompt(threadId: string, prompt: string, imageBase64?: string): Promise<string> {
  let content: unknown = prompt;
  if (imageBase64) {
    content = [
      { type: "text", text: prompt },
      { type: "image_url", image_url: { url: `data:image/png;base64,${imageBase64}` } },
    ];
  }
  const result = await graph.invoke(
    { messages: [new HumanMessage({ content: content as never })] },
    { configurable: { thread_id: threadId } }
  );
  return result.finalResponse || "";
}

const check = (response: string, label: string, ...terms: string[]) => ({
  label,
  ok: terms.some(t => response.toLowerCase().includes(t.toLowerCase()))
});
const checkAbsent = (response: string, label: string, ...terms: string[]) => ({
  label,
  ok: !terms.some(t => response.toLowerCase().includes(t.toLowerCase()))
});

async function main() {
  const results: TestResult[] = [];
  let passCount = 0;
  // Délai entre chaque test pour respecter le rate limit TPM (8000 tokens/min ≈ 133 tokens/sec)
  // Chaque test consomme ~1500-2500 tokens → délai de 15s entre tests
  const INTER_TEST_DELAY_MS = 15000;

  console.log("\n╔═══════════════════════════════════════════════════════════╗");
  console.log("║         KIRAA AGENT — 10 PROMPT TEST SUITE               ║");
  console.log(`║  (délai inter-test: ${INTER_TEST_DELAY_MS/1000}s pour respect TPM rate limit)  ║`);
  console.log("╚═══════════════════════════════════════════════════════════╝\n");

  const tests: Array<() => Promise<{ passed: boolean; result: TestResult }>> = [

    // TEST 1 — SUV intra-journalier 17h–23h
    async () => {
      const id=1; const scenario="SUV intra-journalier (17h–23h), 28 ans, 5 ans permis";
      const prompt="Bonjour, je veux louer une voiture SUV demain de 17h à 23h. J'ai 28 ans et 5 ans de permis.";
      console.log(`\n[TEST ${id}] ${scenario}\n  → "${prompt}"`);
      const response = await runPrompt(`t${id}`, prompt);
      console.log(`  ← Réponse:\n${response.slice(0,700)}\n`);
      const checks = [
        check(response, "Mentionne 1 jour / forfait", "1 jour","une journée","forfait"),
        check(response, "Mentionne tarif SUV ~520 MAD", "520","598","mad"),
        check(response, "Caution 5000 MAD", "5000","5 000","caution"),
        check(response, "Assurance incluse/gratuite", "incluse","gratuit","0 mad"),
        checkAbsent(response, "Pas de refus", "refus","inéligible","rejet"),
      ];
      const passed = checks.every(c=>c.ok);
      return { passed, result: { id, scenario, prompt, passed, response, checks } };
    },

    // TEST 2 — Mineur 19 ans → Rejet
    async () => {
      const id=2; const scenario="Conducteur mineur 19 ans → Rejet automatique";
      const prompt="Salut, j'ai 19 ans et je veux louer une Economy pour 3 jours. Combien ça coûte?";
      console.log(`\n[TEST ${id}] ${scenario}\n  → "${prompt}"`);
      const response = await runPrompt(`t${id}`, prompt);
      console.log(`  ← Réponse:\n${response.slice(0,600)}\n`);
      const checks = [
        check(response, "Rejet explicite", "refus","rejet","inéligible","ne pouvons pas","impossible","minimum","requis"),
        check(response, "Mentionne âge minimum 21 ans", "21"),
        checkAbsent(response, "AUCUN prix", "total à payer","tarif journalier"),
      ];
      const passed = checks.every(c=>c.ok);
      return { passed, result: { id, scenario, prompt, passed, response, checks } };
    },

    // TEST 3 — Permis 1 an → Rejet
    async () => {
      const id=3; const scenario="Permis < 2 ans (23 ans, 1 an) → Rejet";
      const prompt="Bonjour, j'ai 23 ans mais seulement 1 an de permis. Je veux louer un Compact 2 jours.";
      console.log(`\n[TEST ${id}] ${scenario}\n  → "${prompt}"`);
      const response = await runPrompt(`t${id}`, prompt);
      console.log(`  ← Réponse:\n${response.slice(0,600)}\n`);
      const checks = [
        check(response, "Rejet permis < 2 ans", "refus","rejet","inéligible","ne pouvons pas","2 ans","ancienneté"),
        checkAbsent(response, "AUCUN prix", "total à payer","tarif journalier"),
      ];
      const passed = checks.every(c=>c.ok);
      return { passed, result: { id, scenario, prompt, passed, response, checks } };
    },

    // TEST 4 — 22 ans Premium → Escalade
    async () => {
      const id=4; const scenario="22 ans + Premium → Escalade humaine";
      const prompt="J'ai 22 ans, 2 ans de permis. Je voudrais louer une voiture Premium pour 5 jours.";
      console.log(`\n[TEST ${id}] ${scenario}\n  → "${prompt}"`);
      const response = await runPrompt(`t${id}`, prompt);
      console.log(`  ← Réponse:\n${response.slice(0,700)}\n`);
      const checks = [
        check(response, "Escalade / validation humaine", "validation","humaine","agent","conseiller","examin","appel","manuellement"),
        check(response, "Caution majorée / jeune conducteur", "jeune","majorée","caution","50%","25 ans"),
      ];
      const passed = checks.every(c=>c.ok);
      return { passed, result: { id, scenario, prompt, passed, response, checks } };
    },

    // TEST 5 — Politique annulation (RAG)
    async () => {
      const id=5; const scenario="Question politique annulation (RAG)";
      const prompt="Quelle est votre politique d'annulation? Je peux récupérer mon argent si j'annule 3 jours avant?";
      console.log(`\n[TEST ${id}] ${scenario}\n  → "${prompt}"`);
      const response = await runPrompt(`t${id}`, prompt);
      console.log(`  ← Réponse:\n${response.slice(0,700)}\n`);
      const checks = [
        check(response, "Répond à l'annulation", "annulation","48h","remboursement","frais","annuler","rembours"),
        checkAbsent(response, "Pas de devis tarifaire", "total à payer","tarif journalier"),
      ];
      const passed = checks.every(c=>c.ok);
      return { passed, result: { id, scenario, prompt, passed, response, checks } };
    },

    // TEST 6 — Economy 10j + remise 10%
    async () => {
      const id=6; const scenario="Economy 10 jours + remise 10%";
      const prompt="Bonjour, j'ai 35 ans et 10 ans de permis. Je voudrais louer une Economy 10 jours avec 10% de remise.";
      console.log(`\n[TEST ${id}] ${scenario}\n  → "${prompt}"`);
      const response = await runPrompt(`t${id}`, prompt);
      console.log(`  ← Réponse:\n${response.slice(0,800)}\n`);
      const checks = [
        check(response, "Mentionne Economy", "economy","économ"),
        check(response, "Mentionne 10 jours", "10 jour"),
        check(response, "Remise / réduction 10%", "remise","10%","réduction"),
        check(response, "Caution Economy 2000 MAD", "2000","2 000"),
        checkAbsent(response, "Pas de rejet", "rejet","inéligible"),
      ];
      const passed = checks.every(c=>c.ok);
      return { passed, result: { id, scenario, prompt, passed, response, checks } };
    },

    // TEST 7 — Assurance/Franchise (RAG)
    async () => {
      const id=7; const scenario="Assurance tous risques / franchise (RAG)";
      const prompt="Qu'est-ce que l'option Tous Risques? C'est quoi le rachat de franchise? Quelle différence avec l'assurance de base?";
      console.log(`\n[TEST ${id}] ${scenario}\n  → "${prompt}"`);
      const response = await runPrompt(`t${id}`, prompt);
      console.log(`  ← Réponse:\n${response.slice(0,800)}\n`);
      const checks = [
        check(response, "Parle assurance/franchise", "tous risques","franchise","assurance"),
        check(response, "Mentionne tarifs assurance", "80","500","mad","gratuit","incluse"),
      ];
      const passed = checks.every(c=>c.ok);
      return { passed, result: { id, scenario, prompt, passed, response, checks } };
    },

    // TEST 8 — Disponibilité utilitaire
    async () => {
      const id=8; const scenario="Disponibilité véhicule utilitaire";
      const prompt="Est-ce que vous avez des véhicules utilitaires disponibles ce weekend?";
      console.log(`\n[TEST ${id}] ${scenario}\n  → "${prompt}"`);
      const response = await runPrompt(`t${id}`, prompt);
      console.log(`  ← Réponse:\n${response.slice(0,700)}\n`);
      const checks = [
        check(response, "Répond disponibilité utilitaire", "disponible","utilitaire","utility","weekend"),
        checkAbsent(response, "Pas de refus inéligibilité", "inéligible","rejet"),
      ];
      const passed = checks.every(c=>c.ok);
      return { passed, result: { id, scenario, prompt, passed, response, checks } };
    },

    // TEST 9 — JSON OCR permis éligible
    async () => {
      const id=9; const scenario="JSON OCR permis (Ahmed Benali, 28 ans, 5 ans) + SUV 3j tous risques";
      const jsonData = JSON.stringify({
        document_type:"permis_conduire", first_name:"Ahmed", last_name:"Benali",
        date_of_birth:"1998-03-15", license_number:"MA-2019-567890",
        id_number:"BE123456", issue_date:"2019-06-01"
      });
      const prompt = `Voici les données OCR de mon permis : ${jsonData}\nJe voudrais louer un SUV 3 jours avec assurance tous risques.`;
      console.log(`\n[TEST ${id}] ${scenario}\n  → (JSON permis + SUV 3j tous risques)`);
      const response = await runPrompt(`t${id}`, prompt);
      console.log(`  ← Réponse:\n${response.slice(0,900)}\n`);
      const checks = [
        check(response, "Reconnaît Ahmed/Benali/permis", "ahmed","benali","permis","ma-2019"),
        check(response, "3 jours SUV", "3 jour","suv"),
        check(response, "Tous risques / 80 MAD", "tous risques","80"),
        checkAbsent(response, "Pas de rejet", "rejet","inéligible"),
      ];
      const passed = checks.every(c=>c.ok);
      return { passed, result: { id, scenario, prompt, passed, response, checks } };
    },

    // TEST 10 — Image permis (PNG) + Compact 2j
    async () => {
      const id=10; const scenario="Image permis (PNG) + Compact 2 jours";
      const pdfPath="/Users/mac/Downloads/kiraa_notebook_package/permis.pdf";
      let imageBase64: string|undefined;
      try { imageBase64 = fs.readFileSync(pdfPath).toString("base64"); }
      catch { console.warn("  ⚠ Impossible de lire permis.pdf"); }
      const prompt="Voici mon permis de conduire en image. Je voudrais louer un Compact pour 2 jours la semaine prochaine.";
      console.log(`\n[TEST ${id}] ${scenario}\n  → "${prompt}" + image permis`);
      const response = await runPrompt(`t${id}`, prompt, imageBase64);
      console.log(`  ← Réponse:\n${response.slice(0,900)}\n`);
      const checks = [
        check(response, "Compact / 2 jours", "compact","2 jour"),
        check(response, "Mentionne permis/doc/tarif/caution/âge", "permis","document","âge","ancienneté","caution","mad","total"),
      ];
      const passed = checks.every(c=>c.ok);
      return { passed, result: { id, scenario, prompt, passed, response, checks } };
    },
  ];

  for (let i = 0; i < tests.length; i++) {
    try {
      const { passed, result } = await tests[i]();
      if (passed) passCount++;
      results.push(result);
      result.checks.forEach(c => console.log(`    [${c.ok?"✓":"✗"}] ${c.label}`));
    } catch (e) {
      console.error(`  ✗ Erreur fatale test ${i+1}:`, e);
      results.push({ id: i+1, scenario: `Test ${i+1}`, prompt:"", passed:false, response: String(e), checks:[] });
    }
    // Délai inter-test pour respecter TPM rate limit (sauf dernier test)
    if (i < tests.length - 1) {
      console.log(`\n  ⏳ Délai ${INTER_TEST_DELAY_MS/1000}s avant test suivant (rate limit protection)...`);
      await sleep(INTER_TEST_DELAY_MS);
    }
  }

  console.log("\n╔═══════════════════════════════════════════════════════════╗");
  console.log(`║  RÉSULTAT FINAL : ${passCount}/10 tests passés                       ║`);
  console.log("╚═══════════════════════════════════════════════════════════╝\n");
  console.log("RÉCAPITULATIF:");
  results.forEach(r => {
    const status = r.passed ? "✅ PASS" : "❌ FAIL";
    console.log(`  [${r.id}] ${status} — ${r.scenario}`);
    if (!r.passed) r.checks.filter(c=>!c.ok).forEach(c=>console.log(`       ✗ ${c.label}`));
  });

  const reportPath = path.join(process.cwd(), "scripts/test_report.json");
  fs.writeFileSync(reportPath, JSON.stringify(results.map(r=>({
    id:r.id, scenario:r.scenario, passed:r.passed, checks:r.checks,
    response_excerpt: r.response.slice(0,400)
  })), null, 2));
  console.log(`\n📄 Rapport JSON: ${reportPath}\n`);
}

main().catch(e => { console.error("Erreur fatale:", e); process.exit(1); });
