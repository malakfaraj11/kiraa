import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import { Pool } from 'pg';
import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';

// ──────────────────────────────────────────────────────────────────────────────
// HashingVectorizer for RAG (identical to rag.ts implementation)
// ──────────────────────────────────────────────────────────────────────────────
function generateEmbedding(text: string): number[] {
  const vec = new Array(1536).fill(0);
  const words = text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .split(/\W+/)
    .filter((w) => w.length > 2);
  for (const word of words) {
    let h = 0;
    for (let i = 0; i < word.length; i++) {
      h = (h * 31 + word.charCodeAt(i)) | 0;
    }
    const idx = Math.abs(h) % 1536;
    vec[idx] += 1;
  }
  let norm = 0;
  for (let i = 0; i < 1536; i++) norm += vec[i] * vec[i];
  norm = Math.sqrt(norm);
  if (norm > 0) {
    for (let i = 0; i < 1536; i++) vec[i] /= norm;
  }
  return vec;
}

// ──────────────────────────────────────────────────────────────────────────────
// CSV parser (simple, no external dependency)
// ──────────────────────────────────────────────────────────────────────────────
function parseCsv(content: string): Record<string, string>[] {
  const lines = content.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n').filter(Boolean);
  const headers = lines[0].split(',').map((h) => h.trim());
  return lines.slice(1).map((line) => {
    const vals = line.split(',').map((v) => v.trim());
    return Object.fromEntries(headers.map((h, i) => [h, vals[i] ?? '']));
  });
}

async function seed() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const client = await pool.connect();

  const DATA_DIR = path.resolve(__dirname, '../../data');

  try {
    console.log('🌱 Kiraa — Démarrage du seed idempotent...\n');

    // ── 0. Activate pgvector ───────────────────────────────────────────────
    await client.query('CREATE EXTENSION IF NOT EXISTS vector');
    console.log('✅ Extension pgvector activée');

    // ── 1. fleet_catalog ──────────────────────────────────────────────────
    const fleetCsv = fs.readFileSync(path.join(DATA_DIR, 'fleet_catalog.csv'), 'utf-8');
    const fleet = parseCsv(fleetCsv);
    let inserted = 0;
    for (const row of fleet) {
      const res = await client.query(
        `INSERT INTO fleet_catalog (vehicle_id, make, model, year, category, transmission, fuel_type, base_daily_rate, vehicles_available, location)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
         ON CONFLICT (vehicle_id) DO NOTHING`,
        [row.vehicle_id, row.make, row.model, parseInt(row.year), row.category, row.transmission,
         row.fuel_type, parseFloat(row.base_daily_rate), parseInt(row.vehicles_available), row.location]
      );
      inserted += res.rowCount ?? 0;
    }
    const { rows: fleetCount } = await client.query('SELECT COUNT(*) FROM fleet_catalog');
    console.log(`✅ fleet_catalog     : ${inserted} nouveaux insérés — total ${fleetCount[0].count}`);

    // ── 2. customer_profiles ──────────────────────────────────────────────
    const custCsv = fs.readFileSync(path.join(DATA_DIR, 'customer_profiles.csv'), 'utf-8');
    const customers = parseCsv(custCsv);
    inserted = 0;
    for (const row of customers) {
      const res = await client.query(
        `INSERT INTO customer_profiles (customer_id, full_name, birth_date, license_number, license_issue_date, license_exp_date, risk_category)
         VALUES ($1,$2,$3,$4,$5,$6,$7)
         ON CONFLICT (customer_id) DO NOTHING`,
        [row.customer_id, row.full_name, row.birth_date, row.license_number,
         row.license_issue_date, row.license_exp_date, row.risk_category]
      );
      inserted += res.rowCount ?? 0;
    }
    const { rows: custCount } = await client.query('SELECT COUNT(*) FROM customer_profiles');
    console.log(`✅ customer_profiles : ${inserted} nouveaux insérés — total ${custCount[0].count}`);

    // ── 3. booking_logs ───────────────────────────────────────────────────
    const bookCsv = fs.readFileSync(path.join(DATA_DIR, 'booking_logs.csv'), 'utf-8');
    const bookings = parseCsv(bookCsv);
    inserted = 0;
    for (const row of bookings) {
      const res = await client.query(
        `INSERT INTO booking_logs (booking_id, customer_id, vehicle_id, start_date, end_date, days, insurance_option, deposit_amount, discount_code, seasonal_multiplier)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
         ON CONFLICT (booking_id) DO NOTHING`,
        [row.booking_id, row.customer_id || null, row.vehicle_id || null,
         row.start_date, row.end_date, parseInt(row.days), row.insurance_option,
         parseFloat(row.deposit_amount), row.discount_code || null, parseFloat(row.seasonal_multiplier)]
      );
      inserted += res.rowCount ?? 0;
    }
    const { rows: bookCount } = await client.query('SELECT COUNT(*) FROM booking_logs');
    console.log(`✅ booking_logs      : ${inserted} nouveaux insérés — total ${bookCount[0].count}`);

    // ── 4. seasonal_pricing_matrix ────────────────────────────────────────
    const seasCsv = fs.readFileSync(path.join(DATA_DIR, 'seasonal_pricing_matrix.csv'), 'utf-8');
    const seasonal = parseCsv(seasCsv);
    inserted = 0;
    for (const row of seasonal) {
      const res = await client.query(
        `INSERT INTO seasonal_pricing_matrix (month, category, multiplier)
         VALUES ($1,$2,$3)
         ON CONFLICT DO NOTHING`,
        [parseInt(row.month), row.category, parseFloat(row.multiplier)]
      );
      inserted += res.rowCount ?? 0;
    }
    const { rows: seasCount } = await client.query('SELECT COUNT(*) FROM seasonal_pricing_matrix');
    console.log(`✅ seasonal_pricing  : ${inserted} nouveaux insérés — total ${seasCount[0].count}`);

    // ── 5. rental_policies_embeddings (RAG) ───────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS rental_policies_embeddings (
        id VARCHAR(255) PRIMARY KEY,
        content TEXT NOT NULL,
        embedding vector(1536) NOT NULL
      )
    `);

    const policies = fs.readFileSync(path.join(DATA_DIR, 'rental_policies.md'), 'utf-8');
    const chunks = policies.split('\n## ').map((c) => c.trim()).filter(Boolean);
    const { rows: existingVectors } = await client.query('SELECT COUNT(*) FROM rental_policies_embeddings');

    if (parseInt(existingVectors[0].count) === 0) {
      for (const chunk of chunks) {
        const embedding = generateEmbedding(chunk);
        const vectorStr = `[${embedding.join(',')}]`;
        await client.query(
          'INSERT INTO rental_policies_embeddings (id, content, embedding) VALUES ($1, $2, $3::vector)',
          [randomUUID(), chunk, vectorStr]
        );
      }
      console.log(`✅ rental_policies   : ${chunks.length} sections indexées (RAG pgvector)`);
    } else {
      console.log(`⏭️  rental_policies   : déjà indexées (${existingVectors[0].count} sections) — skip`);
    }

    console.log('\n🎉 Seed terminé avec succès — toutes les tables sont prêtes !');
    console.log('   Pour réindexer les politiques RAG, videz la table rental_policies_embeddings manuellement.\n');

  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('❌ Seed échoué:', msg);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
    process.exit(0);
  }
}

seed();
