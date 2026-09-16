import * as dotenv from 'dotenv';
// MUST be first before any other import that might trigger db pool creation
dotenv.config({ path: '.env.local' });

import { Pool } from 'pg';
import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';

function generateMockEmbedding(text: string): number[] {
  const vec = new Array(1536).fill(0);
  const words = text.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').split(/\W+/).filter(w => w.length > 2);
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

async function seed() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
  });

  console.log('Connexion à PostgreSQL...');
  const client = await pool.connect();

  try {
    // Activate extension
    await client.query('CREATE EXTENSION IF NOT EXISTS vector');
    console.log('Extension pgvector activée.');

    // Create the table if not exists
    await client.query(`
      CREATE TABLE IF NOT EXISTS rental_policies_embeddings (
        id VARCHAR(255) PRIMARY KEY,
        content TEXT NOT NULL,
        embedding vector(1536) NOT NULL
      )
    `);
    console.log('Table rental_policies_embeddings prête.');

    // Read and chunk the policies file
    const filePath = path.join(__dirname, '../../data/rental_policies.md');
    const content = fs.readFileSync(filePath, 'utf-8');
    const chunks = content.split('\n## ').map(c => c.trim()).filter(Boolean);

    console.log(`Création des embeddings pour ${chunks.length} sections...`);

    // Clear old data
    await client.query('TRUNCATE TABLE rental_policies_embeddings');

    for (const chunk of chunks) {
      const embedding = generateMockEmbedding(chunk);
      const vectorStr = `[${embedding.join(',')}]`;
      await client.query(
        'INSERT INTO rental_policies_embeddings (id, content, embedding) VALUES ($1, $2, $3::vector)',
        [randomUUID(), chunk, vectorStr]
      );
    }

    console.log(`✅ RAG Seed terminé : ${chunks.length} sections indexées.`);
  } finally {
    client.release();
    await pool.end();
    process.exit(0);
  }
}

seed().catch((e) => {
  console.error('❌ Seed échoué:', e.message);
  process.exit(1);
});
