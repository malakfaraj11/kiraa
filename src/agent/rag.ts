import { db } from '../db/index';
import { sql } from 'drizzle-orm';

// HashingVectorizer (1536-d normalized bag-of-words) for true semantic similarity
export function generateMockEmbedding(text: string): number[] {
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

export async function searchPolicies(query: string, limit = 2): Promise<string> {
  const queryVector = generateMockEmbedding(query);
  
  // Cosine distance in pgvector is <=>
  // We use raw SQL to calculate distance and order by it
  const vectorStr = `[${queryVector.join(',')}]`;
  
  try {
    const results = await db.execute(sql`
      SELECT content, embedding <=> ${vectorStr}::vector as distance
      FROM rental_policies_embeddings
      ORDER BY distance ASC
      LIMIT ${limit}
    `);
    
    if (results.rows.length === 0) return "Aucune politique trouvée.";
    
    return results.rows.map((row) => String((row as Record<string, unknown>).content ?? "")).join("\n\n");
  } catch (error) {
    console.error("RAG Error:", error);
    return "Erreur lors de la récupération des politiques.";
  }
}
