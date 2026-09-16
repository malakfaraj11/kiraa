import { db } from './index';
import { fleetCatalog } from './schema';
import { sql } from 'drizzle-orm';
import { z } from 'zod';

/**
 * Moteur Déterministe : Vérification de disponibilité
 * Actuellement simplifié : vérifie la flotte totale sans soustraire les logs de réservation (MVP)
 */
export async function checkAvailability(category: string): Promise<boolean> {
  try {
    const vehicles = await db.select().from(fleetCatalog).where(
      sql`lower(${fleetCatalog.category}) = lower(${category})`
    );
    if (!vehicles || vehicles.length === 0) return false;
    const totalAvailable = vehicles.reduce((sum, v) => sum + v.vehiclesAvailable, 0);
    return totalAvailable > 0;
  } catch (e) {
    console.warn('DB unavailable, defaulting to available:', e);
    return true;
  }
}

/**
 * Cautions officielles par catégorie selon rental_policies.md :
 * - Economy : 2 000 MAD
 * - Compact : 3 000 MAD
 * - SUV : 5 000 MAD
 * - Premium : 15 000 MAD
 * - Utility : 7 000 MAD
 * (Majorée de +50% pour les jeunes conducteurs < 25 ans)
 */
export const OFFICIAL_DEPOSIT_BY_CATEGORY: Record<string, number> = {
  economy: 2000,
  compact: 3000,
  suv: 5000,
  premium: 15000,
  utility: 7000,
};

/**
 * Matrice saisonnière déterministe de secours (Cahier des Charges)
 */
export const DEFAULT_SEASONAL_MATRIX: Record<number, Record<string, number>> = {
  6: { compact: 1.15, economy: 1.1, suv: 1.2, premium: 1.3, utility: 1.1 },
  7: { compact: 1.2, economy: 1.15, suv: 1.25, premium: 1.35, utility: 1.15 },
  8: { compact: 1.25, economy: 1.2, suv: 1.3, premium: 1.4, utility: 1.2 },
  9: { compact: 1.15, economy: 1.1, suv: 1.15, premium: 1.25, utility: 1.1 },
  12: { compact: 1.15, economy: 1.1, suv: 1.2, premium: 1.3, utility: 1.1 },
};

export function getSeasonalMultiplierFallback(month: number, category: string): number {
  const catKey = category.toLowerCase();
  if (DEFAULT_SEASONAL_MATRIX[month] && DEFAULT_SEASONAL_MATRIX[month][catKey]) {
    return DEFAULT_SEASONAL_MATRIX[month][catKey];
  }
  return 1.0;
}

/**
 * Options d'assurance selon rental_policies.md :
 * - Base : 0 MAD (incluse gratuitement dans le tarif de location)
 * - Tous Risques : 80 MAD / jour
 * - Rachat de Franchise : 500 MAD forfait unique
 */
export const INSURANCE_PRICING = {
  base: 0,
  allriskDaily: 80,
  franchiseBuyout: 500,
};

/**
 * Moteur Déterministe : Calcul du prix
 * Formule cahier des charges : Total = (Base_Price × Days × Seasonal_Mult) + Insurance + Deposit - Capped_Discount
 * Règles d'or :
 * - Remise plafonnée à 15% maximum
 * - Caution majorée de 50% si conducteur < 25 ans
 * - L'assurance de base est incluse sans supplément (0 MAD)
 * - La caution est remboursable et présentée de manière transparente
 */
export function calculatePrice(
  basePrice: number,
  days: number,
  seasonalMult: number,
  insuranceAmount: number,
  depositAmount: number,
  discountPercent: number
): {
  totalAPayer: number;
  caution: number;
  appliedDiscount: number;
  discountAmount: number;
  baseTotal: number;
  dailyRate: number;
  insuranceAmount: number;
  totalFormuleCdC: number;
} {
  // Règle d'or : remise plafonnée à 15% maximum
  const cappedDiscount = Math.min(Math.max(0, discountPercent), 15);

  const baseTotal = Math.round(basePrice * days * seasonalMult * 100) / 100;
  const discountAmount = Math.round(baseTotal * (cappedDiscount / 100) * 100) / 100;

  // Montant effectif de la location à payer (location + assurance optionnelle - remise)
  const totalAPayer = Math.round(((baseTotal - discountAmount) + insuranceAmount) * 100) / 100;

  // Formule stricte du Cahier des Charges (Page 6): Total = Base_Price × Days × Seasonal_Mult + Insurance + Deposit - Capped_Discount
  const totalFormuleCdC = Math.round((totalAPayer + depositAmount) * 100) / 100;

  return {
    totalAPayer,
    caution: Math.round(depositAmount * 100) / 100,
    appliedDiscount: cappedDiscount,
    discountAmount,
    baseTotal,
    dailyRate: basePrice,
    insuranceAmount,
    totalFormuleCdC,
  };
}

/**
 * Validation Zod des règles booléennes (ValidatorNode)
 */
export const driverValidationSchema = z.object({
  age: z.number().min(21, "Le conducteur doit avoir au moins 21 ans."),
  licenseDurationYears: z.number().min(2, "Le permis doit être valide depuis plus de 2 ans."),
  isLicenseExpired: z.boolean().optional(),
});

/**
 * Fonction de validation du conducteur.
 * Retourne { isValid: boolean, requiresIncreasedDeposit: boolean, errors: string[] }
 */
export function validateDriver(
  age: number,
  licenseDurationYears: number,
  isLicenseExpired?: boolean
): { isValid: boolean; requiresIncreasedDeposit: boolean; errors: string[] } {
  const result = driverValidationSchema.safeParse({
    age,
    licenseDurationYears,
    isLicenseExpired,
  });

  const errors: string[] = [];

  // 1. Si la validation Zod échoue (âge < 21 ou permis < 2 ans)
  if (!result.success) {
    errors.push(...result.error.issues.map((issue) => issue.message));
  }

  // 2. Vérification du permis expiré
  if (isLicenseExpired === true) {
    errors.push("Le permis de conduire est expiré.");
  }

  if (errors.length > 0) {
    return {
      isValid: false,
      requiresIncreasedDeposit: false,
      errors,
    };
  }

  // 3. Seulement si le conducteur est éligible, on applique la règle de caution majorée
  const requiresIncreasedDeposit = age < 25; // Caution +50% si moins de 25 ans

  return {
    isValid: true,
    requiresIncreasedDeposit,
    errors: [],
  };
}

/**
 * Contrôle de kilométrage (Cahier des Charges §4.4)
 * Formule :
 * depassement_km = max(0, km_parcourus - km_inclus_contrat)
 * penalite = depassement_km × tarif_km_supplementaire (2.50 MAD / km par défaut)
 */
export function calculateMileagePenalty(
  kmDriven: number,
  kmAllowed: number,
  extraKmRate: number = 2.50
): {
  kmDriven: number;
  kmAllowed: number;
  kmOverage: number;
  extraKmRate: number;
  penalty: number;
} {
  const kmOverage = Math.max(0, kmDriven - kmAllowed);
  const penalty = Math.round(kmOverage * extraKmRate * 100) / 100;
  return {
    kmDriven,
    kmAllowed,
    kmOverage,
    extraKmRate,
    penalty,
  };
}

