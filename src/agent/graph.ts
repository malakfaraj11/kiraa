import { StateGraph, START, END, Annotation, MemorySaver } from "@langchain/langgraph";
import { BaseMessage, SystemMessage } from "@langchain/core/messages";
import { ChatGroq } from "@langchain/groq";
import { checkAvailability, calculatePrice, validateDriver, OFFICIAL_DEPOSIT_BY_CATEGORY, INSURANCE_PRICING, getSeasonalMultiplierFallback } from "@/db/queries";
import { searchPolicies } from "./rag";

export interface ExtractedData {
  age?: string | number;
  licenseDuration?: string | number;
  vehicleType?: string;
  days?: string | number;
  discount?: string | number;
  insuranceType?: string;
  hoursDetail?: string;
  ragContext?: string;
  intention?: string;
  [key: string]: unknown;
}

export interface ValidationStatus {
  isEligible?: boolean;
  requiresIncreasedDeposit?: boolean;
  needsHumanReview?: boolean;
  isAvailable?: boolean;
  notes?: string[];
  escalationReasons?: string[];
  [key: string]: unknown;
}

export interface CalculationResult {
  totalAPayer?: number;
  caution?: number;
  appliedDiscount?: number;
  discountAmount?: number;
  baseTotal?: number;
  dailyRate?: number;
  insuranceAmount?: number;
  totalFormuleCdC?: number;
  vehicleCategory?: string;
  days?: number;
  hoursDetail?: string | null;
  insuranceLabel?: string;
  isYoungDriver?: boolean;
  seasonalMult?: number;
  effectiveDailyRate?: number;
  [key: string]: unknown;
}

// 1. Definition of the State using Annotation
export const AgentStateAnnotation = Annotation.Root({
  messages: Annotation<BaseMessage[]>({
    reducer: (x, y) => x.concat(y),
    default: () => [],
  }),
  intention: Annotation<string>({
    reducer: (x, y) => y ?? x,
    default: () => "unknown",
  }),
  extractedData: Annotation<ExtractedData>({
    reducer: (x, y) => ({ ...x, ...y }),
    default: () => ({}),
  }),
  validationStatus: Annotation<ValidationStatus>({
    reducer: (x, y) => ({ ...x, ...y }),
    default: () => ({}),
  }),
  calculationResult: Annotation<CalculationResult>({
    reducer: (x, y) => ({ ...x, ...y }),
    default: () => ({}),
  }),
  finalResponse: Annotation<string>({
    reducer: (x, y) => y ?? x,
    default: () => "",
  }),
});

export type AgentState = typeof AgentStateAnnotation.State;

// Factory LLM
const getModel = () => {
  if (!process.env.GROQ_API_KEY) {
    console.warn("ATTENTION: GROQ_API_KEY n'est pas définie dans les variables d'environnement.");
  }
  return new ChatGroq({
    apiKey: process.env.GROQ_API_KEY,
    model: "openai/gpt-oss-120b",
    temperature: 0,
  });
};

// 2. Nodes Functions (The 7 layers from the specs)
async function ingestorNode(_state: AgentState) {
  // Reçoit le message brut, le transmet tel quel au nœud Extractor
  return {};
}

async function extractorNode(state: AgentState) {
  const model = getModel();

  const systemPrompt = new SystemMessage(
    `Tu es le nœud Extractor de l'agence automobile Kiraa.
Analyse les messages de la conversation et extrais l'intention et toutes les entités de réservation.
Réponds STRICTEMENT sous forme d'un objet JSON au format :
{
  "intention": "calculate_total_cost" | "make_reservation" | "check_availability" | "validate_eligibility" | "policy_query" | "human_escalation" | "out_of_scope",
  "vehicleType": "SUV" | "Economy" | "Compact" | "Premium" | "Utility" | null,
  "days": number | null,
  "hoursDetail": string | null,
  "insuranceType": "base" | "allrisk" | "rachat_franchise" | null,
  "age": number | null,
  "licenseDuration": number | null,
  "discount": number | null,
  "driverName": string | null,
  "idNumber": string | null,
  "licenseNumber": string | null
}

RÈGLES D'EXTRACTION:
1. Durée & Tranche horaire :
   - Si le client mentionne une tranche horaire intra-journalière (ex: "de 17h à 23h", "6 heures") ou "1 jour seulement", "1 jour" :
     -> "days": 1, "hoursDetail": "17h à 23h" (ou la tranche précisée).
   - Chez Kiraa, toute location intra-journalière est facturée sur la base minimale de 1 journée ("days": 1).
2. Véhicule :
   - Si "SUV" est mentionné ou était dans les messages précédents : "vehicleType": "SUV".
   - Idem pour "Economy", "Compact", "Premium", "Utility".
3. Intention :
   - Si l'utilisateur précise des horaires, un véhicule, demande le coût ou veut louer : "calculate_total_cost" ou "make_reservation".
   - Si question sur les règles contractuelles (annulation, franchise, km, caution) : "policy_query".
   - Si question sur la disponibilité de voitures : "check_availability".
4. Documents & Identité (JSON, OCR, PDF, texte) :
   - Si un document (ex: JSON ou OCR de permis/CNI) contient "date_of_birth" (ex: "1990-01-01") ou mentionne une date de naissance, calcule automatiquement l'âge en années révolues (ex: 2026 - 1990 = 36 ans) -> "age": 36.
   - Si le document contient "first_name" et "last_name", renseigne "driverName" (ex: "Test User").
   - Si le document contient "id_number", renseigne "idNumber" (ex: "AB123456").
   - Si le document contient "license_number", renseigne "licenseNumber" (ex: "D987654321").
   - Si l'ancienneté du permis n'est pas spécifiée explicitement dans le document, conserve "licenseDuration": null.`
  );

  try {
    const response = await model.invoke([systemPrompt, ...state.messages]);
    const content = (response.content as string).trim();
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      return {
        intention: parsed.intention ?? "calculate_total_cost",
        extractedData: parsed,
      };
    }
    return { intention: "calculate_total_cost" as const };
  } catch (e) {
    return { intention: "human_escalation" as const };
  }
}

async function orchestratorNode(_state: AgentState) {
  // Nœud de routage : transmet l'état au nœud suivant via les conditional edges
  return {};
}

async function validatorNode(state: AgentState) {
  const validationResult: Record<string, unknown> & { notes: string[]; escalationReasons: string[] } = {
    isEligible: true,
    requiresIncreasedDeposit: false,
    needsHumanReview: false,
    notes: [],
    escalationReasons: [],
  };

  const age = state.extractedData?.age ? parseInt(String(state.extractedData.age)) : null;
  const licenseDuration = state.extractedData?.licenseDuration ? parseInt(String(state.extractedData.licenseDuration)) : null;
  const vehicleType = String(state.extractedData?.vehicleType || '').toLowerCase();

  if (age !== null) {
    const driverCheck = validateDriver(age, licenseDuration ?? 3);
    validationResult.isEligible = driverCheck.isValid;
    if (driverCheck.requiresIncreasedDeposit) {
      validationResult.notes.push("Conducteur de moins de 25 ans : caution majorée de 50%.");
      validationResult.requiresIncreasedDeposit = true;
    }
    if (!driverCheck.isValid) {
      validationResult.notes.push(...driverCheck.errors);
    }
  }

  // Escalade humaine selon le Cahier des Charges:
  // 1. Jeune conducteur (21-24 ans) sur catégorie Premium
  if (age !== null && age >= 21 && age < 25 && vehicleType === 'premium') {
    validationResult.needsHumanReview = true;
    validationResult.escalationReasons.push("Jeune conducteur (21-24 ans) sur véhicule Premium : validation humaine obligatoire.");
  }

  // 2. Caution supérieure à 20 000 MAD
  const baseDep = OFFICIAL_DEPOSIT_BY_CATEGORY[vehicleType] || 5000;
  const potentialDep = validationResult.requiresIncreasedDeposit ? baseDep * 1.5 : baseDep;
  if (potentialDep > 20000) {
    validationResult.needsHumanReview = true;
    validationResult.escalationReasons.push("Caution supérieure à 20 000 MAD : revue humaine obligatoire.");
  }

  if (vehicleType) {
    try {
      const isAvailable = await checkAvailability(vehicleType);
      validationResult.isAvailable = isAvailable;
      if (!isAvailable) validationResult.notes.push("Aucun véhicule disponible dans cette catégorie.");
    } catch {
      validationResult.isAvailable = true;
    }
  }

  return { validationStatus: validationResult };
}

async function calculatorNode(state: AgentState) {
  const { extractedData, validationStatus } = state;
  const days = Math.max(1, parseInt(String(extractedData?.days ?? '1')) || 1);
  const discountPercent = parseInt(String(extractedData?.discount ?? '0')) || 0;
  const rawVehicleType = String(extractedData?.vehicleType || 'SUV').toLowerCase();
  const vehicleType = rawVehicleType in OFFICIAL_DEPOSIT_BY_CATEGORY ? rawVehicleType : 'suv';

  // 1. Tarif journalier de base depuis PostgreSQL (fleet_catalog)
  let basePrice = 520; // fallback SUV
  try {
    const { db: dbInst } = await import('@/db/index');
    const { fleetCatalog } = await import('@/db/schema');
    const { sql: sqlFn } = await import('drizzle-orm');
    const vehicles = await dbInst.select().from(fleetCatalog).where(
      sqlFn`lower(${fleetCatalog.category}) = lower(${vehicleType})`
    );
    if (vehicles.length > 0) {
      basePrice = parseFloat(vehicles[0].baseDailyRate);
    }
  } catch (dbErr) {
    console.warn('DB price lookup failed, using fallback:', dbErr);
  }

  // 2. Multiplicateur saisonnier
  const currentMonth = new Date().getMonth() + 1;
  let seasonalMult = getSeasonalMultiplierFallback(currentMonth, vehicleType);
  try {
    const { db: dbInst } = await import('@/db/index');
    const { seasonalPricingMatrix } = await import('@/db/schema');
    const { sql: sqlFn } = await import('drizzle-orm');
    const seasonal = await dbInst.select().from(seasonalPricingMatrix).where(
      sqlFn`month = ${currentMonth} AND lower(${seasonalPricingMatrix.category}) = lower(${vehicleType})`
    );
    if (seasonal.length > 0 && seasonal[0].multiplier) {
      seasonalMult = parseFloat(seasonal[0].multiplier);
    }
  } catch (e) {
    // Garder la valeur déterministe de getSeasonalMultiplierFallback
  }

  // 3. Assurance selon rental_policies.md :
  // - Assurance de base : INCLUSE GRATUITEMENT (0 MAD supplémentaire)
  // - Assurance Tous Risques : 80 MAD / jour
  // - Rachat de Franchise : 500 MAD forfait unique
  let insuranceAmount = 0;
  let insuranceLabel = "Assurance de base (incluse gratuitement - 0 MAD)";
  const insType = String(extractedData?.insuranceType || 'base').toLowerCase();
  if (insType.includes('allrisk') || insType.includes('tous risques')) {
    insuranceAmount = INSURANCE_PRICING.allriskDaily * days;
    insuranceLabel = `Option Tous Risques (${insuranceAmount} MAD soit 80 MAD/j)`;
  } else if (insType.includes('rachat') || insType.includes('franchise')) {
    insuranceAmount = INSURANCE_PRICING.franchiseBuyout;
    insuranceLabel = `Option Rachat de Franchise (${insuranceAmount} MAD forfait unique)`;
  }

  // 4. Caution obligatoire selon rental_policies.md :
  // Economy: 2 000 MAD | Compact: 3 000 MAD | SUV: 5 000 MAD | Premium: 15 000 MAD | Utility: 7 000 MAD
  let depositAmount = OFFICIAL_DEPOSIT_BY_CATEGORY[vehicleType] || 5000;
  const isYoungDriver = validationStatus?.requiresIncreasedDeposit || (extractedData?.age && parseInt(String(extractedData.age)) < 25);
  if (isYoungDriver) {
    depositAmount = Math.round(depositAmount * 1.5); // +50% jeune conducteur < 25 ans
  }

  const effectiveDailyRate = Math.round(basePrice * seasonalMult * 100) / 100;

  const calc = calculatePrice(basePrice, days, seasonalMult, insuranceAmount, depositAmount, discountPercent);
  return {
    calculationResult: {
      ...calc,
      vehicleCategory: vehicleType.toUpperCase(),
      days,
      hoursDetail: extractedData?.hoursDetail ? String(extractedData.hoursDetail) : null,
      insuranceLabel,
      isYoungDriver: !!isYoungDriver,
      seasonalMult,
      effectiveDailyRate,
    },
  };
}

async function explainerNode(state: AgentState) {
  const model = getModel();

  const calc = state.calculationResult || {};
  const val = state.validationStatus || {};
  const hasCalc = Object.keys(calc).length > 0;

  // CAS 1 : CONDUCTEUR INÉLIGIBLE (ÂGE < 21 OU PERMIS < 2 ANS)
  // RÈGLE IMPÉRATIVE DU CAHIER DES CHARGES : "Rejet automatique, motif explicite, AUCUN calcul de prix."
  if (val.isEligible === false) {
    const errorMotifs = val.notes?.length ? val.notes.join(" ; ") : "Critères d'éligibilité non remplis";
    const rejectionPrompt = new SystemMessage(
      `Tu es Kiraa, assistant IA officiel de l'agence de location automobile Kiraa au Maroc.
      
RÉSULTAT DE LA VÉRIFICATION : REJET AUTOMATIQUE DE LA DEMANDE.
Motif(s) du refus : ${errorMotifs}.

RÈGLES D'OR STRICTES DU CAHIER DES CHARGES (SCÉNARIO CONDUCTEUR NON ÉLIGIBLE) :
1. Notifie immédiatement et avec courtoisie le refus catégorique de la réservation.
2. Énonce explicitement le motif réglementaire : l'âge minimum requis est de 21 ans et l'ancienneté minimale du permis est de 2 ans.
3. RÈGLE STRICTE ZÉRO-PRIX : N'AFFICHE ABSOLUMENT AUCUN PRIX, AUCUN TARIF, AUCUN DEVIS, NI AUCUNE CAUTION (même pas "à titre informatif"). Le cahier des charges interdit formellement tout calcul de prix en cas d'inéligibilité ("Rejet automatique, motif explicite, AUCUN calcul de prix").
4. Propose poliment les solutions autorisées :
   - Revenir lorsque l'âge requis (21 ans) ou l'ancienneté du permis (2 ans) sera atteint.
   - Faire effectuer la location par un conducteur principal remplissant l'ensemble des conditions.`
    );

    try {
      const response = await model.invoke([rejectionPrompt, ...state.messages]);
      return { finalResponse: response.content as string };
    } catch (e) {
      return { finalResponse: `Votre demande ne peut pas être acceptée : ${errorMotifs}. Conformément à notre politique, aucun calcul de prix n'est proposé aux dossiers inéligibles.` };
    }
  }

  // CAS 2 : QUESTION SUR LES RÈGLES / POLITIQUES (policy_query)
  if (state.intention === "policy_query") {
    const policyPrompt = new SystemMessage(
      `Tu es Kiraa, assistant IA officiel de l'agence de location automobile Kiraa au Maroc.
Réponds avec courtoisie, clarté et précision professionnelle à la question du client.

CONTEXTE DOCUMENTAIRE POLITIQUES RAG :
${state.extractedData?.ragContext || "Annulation gratuite jusqu'à 48h avant la prise en charge. Caution restituée sous 15 jours. Franchise incluse selon option choisis."}

DIRECTIVES STRICTES POLITIQUES :
1. Réponds directement et précisément à la question posée (ex: annulation, remboursement, caution, assurance).
2. Ne présente AUCUN devis tarifaire, ne demande PAS les informations de permis ou CIN, et ne génère aucun devis.`
    );

    try {
      const response = await model.invoke([policyPrompt, ...state.messages]);
      return { finalResponse: response.content as string };
    } catch (e) {
      return { finalResponse: `Règlement Kiraa : ${state.extractedData?.ragContext || "Toute annulation effectuée plus de 48h avant le début de la location est intégralement remboursée sans frais."}` };
    }
  }

  // CAS 3 : DOSSIER ÉLIGIBLE OU DEMANDE DE DEVIS
  let calcSummary = "Aucun calcul financier nécessaire pour cette demande.";
  if (hasCalc) {
    const hoursText = calc.hoursDetail ? ` (${calc.hoursDetail})` : "";
    const seasonalText = calc.seasonalMult && calc.seasonalMult !== 1.0
      ? ` (Tarif catalogue: ${calc.dailyRate} MAD/j × coefficient saisonnier: ${calc.seasonalMult})`
      : "";

    calcSummary = `
- Catégorie : ${calc.vehicleCategory}
- Durée facturée : ${calc.days} jour(s)${hoursText} [Forfait journalier intra-journalier]
- Tarif journalier appliqué : ${calc.effectiveDailyRate} MAD/jour${seasonalText}
- Sous-total location : ${calc.baseTotal} MAD (${calc.effectiveDailyRate} MAD × ${calc.days} j)
- Assurance : ${calc.insuranceLabel}
- Remise appliquée : ${calc.appliedDiscount}% (${calc.discountAmount} MAD)
- **TOTAL DE LA LOCATION À PAYER** : **${calc.totalAPayer} MAD**
- **Caution remboursable (Dépôt de garantie)** : **${calc.caution} MAD** (${calc.isYoungDriver ? "caution majorée de 50% pour jeune conducteur < 25 ans, " : ""}restituée intégralement à la remise du véhicule)
- Total engagé formule globale CdC (Location + Caution) : ${calc.totalFormuleCdC} MAD`;
  }

  const systemPrompt = new SystemMessage(
    `Tu es Kiraa, assistant IA officiel de l'agence de location automobile Kiraa au Maroc.
Réponds en français avec courtoisie, clarté et précision professionnelle.

Intention : ${state.intention}
Validation : ${JSON.stringify(val)}
Détails Devis Déterministe :
${calcSummary}

Données extraites : ${JSON.stringify(state.extractedData || {})}
Contexte Documentaire RAG : ${state.extractedData?.ragContext || "Aucun"}

DIRECTIVES STRICTES ZÉRO-HALLUCINATION :
1. Si le client précise une location de 1 jour de 17h à 23h (ou durée intra-journalière en heures) :
   - Confirme expressément : location de 1 jour pour la tranche horaire de 17h à 23h (6 heures).
   - Rappelle que toute location sur une même journée est soumise au tarif forfaitaire d'une journée (1 jour).
2. Présente les chiffres avec une clarté absolue :
   - Le tarif journalier appliqué (avec coefficient saisonnier ${calc.seasonalMult || 1.0}) est de ${calc.effectiveDailyRate || 598} MAD.
   - L'assurance de base est **INCLUSE GRATUITEMENT (0 MAD)**.
   - Le **TOTAL À PAYER pour la location** est de **${calc.totalAPayer || 598} MAD** (ce que le client règle pour louer la voiture).
   - La **Caution (Dépôt de garantie)** est de **${calc.caution || 5000} MAD** : bloquée par empreinte bancaire à la prise en charge et **intégralement restituée** sous 15 jours au retour du véhicule si aucun dommage.
3. Si des données conducteur ont été fournies (document JSON, OCR, etc.) :
   - Accueille et confirme poliment les données enregistrées (Nom: ${state.extractedData?.driverName || "reçu"}, CIN: ${state.extractedData?.idNumber || "reçu"}, Permis N°: ${state.extractedData?.licenseNumber || "reçu"}).
   - Si la date de naissance a permis de valider l'âge (${state.extractedData?.age || "≥ 21"} ans), confirme que la condition d'âge est remplie !
   - Si seule l'ancienneté du permis n'était pas dans le document, invite simplement à préciser l'ancienneté du permis (minimum 2 ans).
4. Si le client n'a pas encore renseigné son âge ou l'ancienneté de son permis, invite-le cordialement à les fournir pour valider définitivement son dossier (conditions requises : 21 ans minimum et 2 ans de permis).
5. Ne modifie JAMAIS les montants calculés par le moteur déterministe.`
  );

  try {
    const response = await model.invoke([systemPrompt, ...state.messages]);
    return { finalResponse: response.content as string };
  } catch (e) {
    console.error("Erreur de génération LLM:", e);
    return { finalResponse: "Désolé, je rencontre des difficultés techniques pour vous répondre (Vérifiez la clé API Groq)." };
  }
}

async function reporterNode(state: AgentState) {
  const calc = state.calculationResult || {};
  const val = state.validationStatus || {};

  // Ne générer le PDF de devis QUE si :
  // 1. L'intention est une demande de réservation / devis ("calculate_total_cost" ou "make_reservation")
  // 2. Le conducteur n'est pas inéligible (val.isEligible !== false)
  // 3. Un montant total valide a été calculé (calc.totalAPayer > 0)
  const isQuoteRequest = state.intention === "calculate_total_cost" || state.intention === "make_reservation";
  if (!isQuoteRequest || !calc.totalAPayer || val.isEligible === false) {
    return {};
  }

  try {
    const { PDFDocument, StandardFonts, rgb } = await import("pdf-lib");
    const pdfDoc = await PDFDocument.create();
    const page = pdfDoc.addPage([595, 842]); // A4
    const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
    const fontReg = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const { height } = page.getSize();
    const blue = rgb(0.1, 0.3, 0.7);
    const black = rgb(0, 0, 0);
    const gray = rgb(0.4, 0.4, 0.4);

    // Header
    page.drawText("KIRAA — DEVIS DE LOCATION", { x: 50, y: height - 60, size: 20, font: fontBold, color: blue });
    page.drawText("Agence de Location Automobile — Maroc", { x: 50, y: height - 82, size: 11, font: fontReg, color: gray });
    page.drawLine({ start: { x: 50, y: height - 95 }, end: { x: 545, y: height - 95 }, thickness: 1, color: blue });

    const ref = `KR-${Date.now().toString().slice(-8)}`;
    const date = new Date().toLocaleDateString("fr-MA");
    page.drawText(`Référence : ${ref}`, { x: 50, y: height - 120, size: 10, font: fontReg, color: black });
    page.drawText(`Date : ${date}`, { x: 380, y: height - 120, size: 10, font: fontReg, color: black });

    // Véhicule
    let y = height - 155;
    page.drawText("DÉTAIL DU VÉHICULE", { x: 50, y, size: 12, font: fontBold, color: blue });
    y -= 22;
    page.drawText(`Catégorie : ${String(calc.vehicleCategory ?? "—")}`, { x: 50, y, size: 10, font: fontReg, color: black });
    y -= 18;
    page.drawText(`Durée : ${String(calc.days ?? 1)} jour(s)${calc.hoursDetail ? " (" + String(calc.hoursDetail) + ")" : ""}`, { x: 50, y, size: 10, font: fontReg, color: black });
    y -= 18;
    page.drawText(`Tarif journalier : ${String(calc.dailyRate ?? "—")} MAD/jour`, { x: 50, y, size: 10, font: fontReg, color: black });

    // Financier
    y -= 35;
    page.drawText("DÉCOMPOSITION FINANCIÈRE", { x: 50, y, size: 12, font: fontBold, color: blue });
    page.drawLine({ start: { x: 50, y: y - 5 }, end: { x: 545, y: y - 5 }, thickness: 0.5, color: gray });
    y -= 25;
    page.drawText(`Sous-total location :`, { x: 50, y, size: 10, font: fontReg, color: black });
    page.drawText(`${String(calc.baseTotal ?? "—")} MAD`, { x: 420, y, size: 10, font: fontReg, color: black });
    y -= 18;
    page.drawText(`Remise appliquée (${String(calc.appliedDiscount ?? 0)}%) :`, { x: 50, y, size: 10, font: fontReg, color: black });
    page.drawText(`- ${String(calc.discountAmount ?? 0)} MAD`, { x: 420, y, size: 10, font: fontReg, color: black });
    y -= 18;
    page.drawText(`Assurance :`, { x: 50, y, size: 10, font: fontReg, color: black });
    page.drawText(`${String(calc.insuranceAmount ?? 0)} MAD`, { x: 420, y, size: 10, font: fontReg, color: black });
    y -= 25;
    page.drawLine({ start: { x: 50, y: y + 5 }, end: { x: 545, y: y + 5 }, thickness: 1, color: blue });
    page.drawText("TOTAL À PAYER :", { x: 50, y, size: 12, font: fontBold, color: blue });
    page.drawText(`${String(calc.totalAPayer ?? "—")} MAD`, { x: 420, y, size: 12, font: fontBold, color: blue });
    y -= 25;
    page.drawText(`Caution remboursable :`, { x: 50, y, size: 10, font: fontReg, color: gray });
    page.drawText(`${String(calc.caution ?? "—")} MAD`, { x: 420, y, size: 10, font: fontReg, color: gray });

    // Footer
    page.drawText("Ce devis est valable 48h. La caution est intégralement restituée à la remise du véhicule.",
      { x: 50, y: 60, size: 9, font: fontReg, color: gray });
    page.drawText("Kiraa Location — contact@kiraa.ma — www.kiraa.ma",
      { x: 50, y: 44, size: 9, font: fontReg, color: gray });

    const pdfBytes = await pdfDoc.save();
    const base64 = Buffer.from(pdfBytes).toString("base64");
    const reportUrl = `data:application/pdf;base64,${base64}`;

    const existingResponse = state.finalResponse || "";
    const reportNote = `\n\n📄 **Votre devis officiel est prêt.** [Télécharger le devis PDF (Réf: ${ref})](${reportUrl})`;
    return { finalResponse: existingResponse + reportNote };
  } catch (err) {
    console.error("Erreur génération PDF:", err);
    return {};
  }
}

// 3. Routing Logic
function routeAfterExtraction(state: AgentState) {
  if (state.intention === "human_escalation") return "explainer";
  if (state.intention === "policy_query") return "ragNode"; 
  if (state.intention === "out_of_scope") return "explainer"; 
  return "validator"; // validator -> calculator -> explainer
}

function routeAfterValidation(state: AgentState) {
  // Cahier des Charges Page 3 : Conducteur mineur / inéligible -> "Rejet automatique, motif explicite, AUCUN calcul de prix."
  if (state.validationStatus && state.validationStatus.isEligible === false) {
    return "explainer";
  }
  return "calculator";
}

// 4. Graph Construction
export function createAgentGraph() {
  // MemorySaver persists conversation state in-memory keyed by thread_id
  const checkpointer = new MemorySaver();

  const workflow = new StateGraph(AgentStateAnnotation)
    .addNode("ingestor", ingestorNode)
    .addNode("extractor", extractorNode)
    .addNode("orchestrator", orchestratorNode)
    .addNode("calculator", calculatorNode)
    .addNode("validator", validatorNode)
    .addNode("explainer", explainerNode)
    .addNode("reporter", reporterNode)
    .addNode("ragNode", async (state: AgentState) => {
      const lastMessage = state.messages[state.messages.length - 1];
      const query = lastMessage.content.toString();
      const context = await searchPolicies(query);
      return { extractedData: { ...state.extractedData, ragContext: context } };
    })

    .addEdge(START, "ingestor")
    .addEdge("ingestor", "extractor")
    .addEdge("extractor", "orchestrator")

    .addConditionalEdges("orchestrator", routeAfterExtraction)

    .addConditionalEdges("validator", routeAfterValidation)
    .addEdge("calculator", "explainer")
    .addEdge("ragNode", "explainer")
    .addEdge("explainer", "reporter")
    .addEdge("reporter", END);

  return workflow.compile({ checkpointer });
}
