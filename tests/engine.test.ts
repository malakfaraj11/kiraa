import { describe, it, expect } from 'vitest';
import {
  calculatePrice,
  validateDriver,
  calculateMileagePenalty,
  OFFICIAL_DEPOSIT_BY_CATEGORY,
  INSURANCE_PRICING,
} from '../src/db/queries';

// ═══════════════════════════════════════════════════════════════════════════════
// 14 TESTS UNITAIRES DU MOTEUR DÉTERMINISTE (parité avec kiraa_tutorial_executed.ipynb)
// ═══════════════════════════════════════════════════════════════════════════════

describe('Moteur Déterministe — 14 tests de parité Notebook Python', () => {

  // ── §4.1 Éligibilité conducteur ──────────────────────────────────────────

  it('T01 — Conducteur mineur rejeté (âge 20)', () => {
    const r = validateDriver(20, 3);
    expect(r.isValid).toBe(false);
    expect(r.errors.some(e => e.includes('21'))).toBe(true);
  });

  it('T02 — Permis < 2 ans rejeté même si âge valide', () => {
    const r = validateDriver(30, 1);
    expect(r.isValid).toBe(false);
    expect(r.errors.some(e => e.includes('2 ans'))).toBe(true);
  });

  it('T03 — Permis expiré rejeté', () => {
    const r = validateDriver(30, 5, true);
    expect(r.isValid).toBe(false);
    expect(r.errors.some(e => e.includes('expiré'))).toBe(true);
  });

  it('T04 — Conducteur âge 21 avec 2 ans de permis : éligible', () => {
    const r = validateDriver(21, 2);
    expect(r.isValid).toBe(true);
  });

  it('T05 — Conducteur âge 24 : éligible avec caution majorée', () => {
    const r = validateDriver(24, 3);
    expect(r.isValid).toBe(true);
    expect(r.requiresIncreasedDeposit).toBe(true);
  });

  it('T06 — Conducteur âge 25 : éligible SANS caution majorée', () => {
    const r = validateDriver(25, 3);
    expect(r.isValid).toBe(true);
    expect(r.requiresIncreasedDeposit).toBe(false);
  });

  // ── §4.3 Calcul financier ─────────────────────────────────────────────────

  it('T07 — Remise plafonnée à 15% pour code nominal 25%', () => {
    const r = calculatePrice(500, 3, 1.0, 0, 3000, 25);
    expect(r.appliedDiscount).toBe(15);
    expect(r.discountAmount).toBe(Math.round(500 * 3 * 0.15 * 100) / 100);
  });

  it('T08 — Remise 10% appliquée intégralement (sous le plafond)', () => {
    const r = calculatePrice(500, 3, 1.0, 0, 3000, 10);
    expect(r.appliedDiscount).toBe(10);
  });

  it('T09 — Assurance de base incluse (0 MAD supplément)', () => {
    expect(INSURANCE_PRICING.base).toBe(0);
    const r = calculatePrice(500, 2, 1.0, 0, 3000, 0);
    expect(r.totalAPayer).toBe(1000);
  });

  it('T10 — Assurance Tous Risques 80 MAD/jour sur 3 jours = 240 MAD', () => {
    const insurance = INSURANCE_PRICING.allriskDaily * 3;
    const r = calculatePrice(500, 3, 1.0, insurance, 3000, 0);
    expect(r.insuranceAmount).toBe(240);
    expect(r.totalAPayer).toBe(1500 + 240);
  });

  it('T11 — Coefficient saisonnier septembre (x1.15) appliqué', () => {
    const r = calculatePrice(520, 1, 1.15, 0, 5000, 0);
    expect(r.baseTotal).toBe(Math.round(520 * 1 * 1.15 * 100) / 100);
  });

  it('T12 — Caution SUV standard 5000 MAD', () => {
    expect(OFFICIAL_DEPOSIT_BY_CATEGORY['suv']).toBe(5000);
  });

  it('T13 — Caution Premium jeune conducteur = 15000 × 1.5 = 22500 MAD', () => {
    const base = OFFICIAL_DEPOSIT_BY_CATEGORY['premium'];
    expect(base * 1.5).toBe(22500);
  });

  // ── §4.4 Pénalité kilométrique ────────────────────────────────────────────

  it('T14 — Pénalité kilométrique 50 km dépassés à 2.50 MAD/km = 125 MAD', () => {
    const r = calculateMileagePenalty(1050, 1000, 2.50);
    expect(r.kmOverage).toBe(50);
    expect(r.penalty).toBe(125);
  });

});
