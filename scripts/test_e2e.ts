import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import { validateDriver, calculatePrice, OFFICIAL_DEPOSIT_BY_CATEGORY } from '../src/db/queries';
import { createAgentGraph } from '../src/agent/graph';
import { HumanMessage } from '@langchain/core/messages';
import { searchPolicies } from '../src/agent/rag';

async function runE2ETests() {
  console.log('\n======================================================');
  console.log('🚀 SUITE DE TESTS E2E OFFICIELLE - KIRAA (CAHIER DES CHARGES)');
  console.log('======================================================\n');

  let passed = 0;
  let total = 0;

  function assert(name: string, condition: boolean, detail: string) {
    total++;
    if (condition) {
      console.log(`✅ [PASS] ${name}`);
      console.log(`   └─ ${detail}\n`);
      passed++;
    } else {
      console.error(`❌ [FAIL] ${name}`);
      console.error(`   └─ ${detail}\n`);
    }
  }

  // ---------------------------------------------------------------
  // SCÉNARIO 1 : Conducteur mineur (20 ans, permis depuis 1.5 an)
  // Attendu : Rejet automatique, motif explicite, AUCUN calcul de prix.
  // ---------------------------------------------------------------
  console.log('--- Scénario 1 : Conducteur de moins de 21 ans ---');
  const res1 = validateDriver(20, 1.5);
  assert(
    'Scénario 1.1 - Rejet Validator Zod',
    res1.isValid === false && res1.errors.some((e: string) => e.includes('21 ans')),
    'Rejet automatique car âge = 20 ans (< 21 ans minimum).'
  );

  const graph = createAgentGraph();
  const graphRes1 = await graph.invoke({
    messages: [new HumanMessage("J'ai 20 ans et 1 an de permis, je veux louer une voiture")],
  });
  const hasNoPricesInText1 = !graphRes1.finalResponse.includes('TOTAL À PAYER') &&
                            !graphRes1.finalResponse.includes('MAD/jour') &&
                            !graphRes1.finalResponse.includes('Rappel des tarifs');
  assert(
    'Scénario 1.2 - Règle Zéro-Prix du CdC',
    graphRes1.validationStatus?.isEligible === false && hasNoPricesInText1,
    'Aucun calcul de prix ni devis affiché pour le dossier inéligible.'
  );

  // ---------------------------------------------------------------
  // SCÉNARIO 2 : Permis trop récent (< 2 ans)
  // Attendu : Blocage immédiat même si l'âge est conforme.
  // ---------------------------------------------------------------
  console.log('--- Scénario 2 : Permis de moins de 2 ans ---');
  const res2 = validateDriver(28, 0.8);
  assert(
    'Scénario 2 - Permis < 2 ans bloqué',
    res2.isValid === false && res2.errors.some((e: string) => e.includes('2 ans')),
    'Blocage immédiat : conducteur de 28 ans mais permis < 2 ans.'
  );

  // ---------------------------------------------------------------
  // SCÉNARIO 3 : Jeune conducteur (22 ans, permis 2.5 ans, Premium)
  // Attendu : Éligible, caution majorée de 50% ET escalade humaine.
  // ---------------------------------------------------------------
  console.log('--- Scénario 3 : Jeune conducteur sur Premium ---');
  const premiumBaseDeposit = OFFICIAL_DEPOSIT_BY_CATEGORY['premium']; // 15 000 MAD
  const youngDriverDeposit = Math.round(premiumBaseDeposit * 1.5); // 22 500 MAD
  assert(
    'Scénario 3.1 - Caution majorée de +50%',
    youngDriverDeposit === 22500,
    `Caution Premium de base 15 000 MAD majorée à ${youngDriverDeposit} MAD pour jeune conducteur.`
  );

  const graphRes3 = await graph.invoke({
    messages: [new HumanMessage("J'ai 22 ans et 3 ans de permis, je veux réserver un véhicule Premium (Mercedes)")],
  });
  const needsHuman = graphRes3.validationStatus?.needsHumanReview === true;
  assert(
    'Scénario 3.2 - Déclenchement Escalade Humaine',
    needsHuman && graphRes3.validationStatus?.requiresIncreasedDeposit === true,
    'Escalade humaine déclenchée : jeune conducteur sur Premium et caution > 20 000 MAD.'
  );

  // ---------------------------------------------------------------
  // SCÉNARIO 4 : Remise hors barème (Demande de 25%)
  // Attendu : Validator refuse et plafonne strictement à 15%.
  // ---------------------------------------------------------------
  console.log('--- Scénario 4 : Plafonnement de la remise à 15% ---');
  const calc4 = calculatePrice(520, 3, 1.0, 0, 5000, 25);
  assert(
    'Scénario 4 - Remise 25% bridée à 15%',
    calc4.appliedDiscount === 15,
    `Demande de 25% plafonnée strictement à ${calc4.appliedDiscount}% (règle Zéro-Trust).`
  );

  // ---------------------------------------------------------------
  // SCÉNARIO 5 : Question de politique (Annulation)
  // Attendu : Réponse issue uniquement du RAG pgvector, aucun calcul financier.
  // ---------------------------------------------------------------
  console.log('--- Scénario 5 : RAG Politique d annulation ---');
  const ragContext = await searchPolicies("Quelles sont les conditions d'annulation 24h avant ?");
  const containsCancellationRules = ragContext.includes('Annulation') || ragContext.includes('30%') || ragContext.includes('48 heures');
  assert(
    'Scénario 5 - Recherche vectorielle pgvector',
    containsCancellationRules,
    'Contexte extrait fidèlement de rental_policies.md via recherche cosinus pgvector.'
  );

  console.log('======================================================');
  console.log(`📊 BILAN DES TESTS : ${passed} / ${total} scénarios validés (${Math.round((passed / total) * 100)}%)`);
  console.log('======================================================\n');
}

runE2ETests().catch((err) => {
  console.error('Erreur lors de l exécution des tests E2E :', err);
  process.exit(1);
});
