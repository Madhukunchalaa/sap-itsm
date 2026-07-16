import { GoogleGenerativeAI } from '@google/generative-ai';
import { prisma } from '../config/database';
import { logger } from '../config/logger';

// ---------------------------------------------------------------------------
// RAG over the tenant's own ticket history.
//
// indexResolvedTickets(): embeds every RESOLVED/CLOSED ticket (title +
// description + public resolution comments) via Gemini embeddings (free tier)
// and stores the vector in ticket_embeddings. Re-runs skip unchanged tickets.
//
// findSimilarTickets(): embeds a query and ranks stored vectors by cosine
// similarity, in memory. At this scale (hundreds to a few thousand tickets)
// that is faster and simpler than a vector database.
//
// Only NON-internal comments are indexed, so retrieved snippets are safe to
// show to any authenticated user via the chatbot.
// ---------------------------------------------------------------------------

const EMBED_MODEL = process.env.GEMINI_EMBED_MODEL || 'gemini-embedding-001';

function getEmbedder() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey === 'YOUR_GEMINI_API_KEY_HERE') {
    throw new Error('GEMINI_API_KEY is required for RAG embeddings');
  }
  return new GoogleGenerativeAI(apiKey).getGenerativeModel({ model: EMBED_MODEL });
}

const stripHtml = (s: string) =>
  (s || '').replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();

export async function embedText(text: string): Promise<number[]> {
  const res = await getEmbedder().embedContent(text.slice(0, 8000));
  return res.embedding.values;
}

function cosine(a: number[], b: number[]): number {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return dot / (Math.sqrt(na) * Math.sqrt(nb) || 1);
}

function buildTicketContent(r: any): string {
  const resolution = (r.comments || [])
    .filter((c: any) => !c.internalFlag && !c.deletedAt)
    .slice(-3)
    .map((c: any) => stripHtml(c.text))
    .filter(Boolean)
    .join(' | ');
  return [
    `Ticket ${r.recordNumber} [${r.recordType}/${r.priority}]: ${r.title}`,
    r.sapModule?.name ? `Module: ${r.sapModule.name}` : '',
    r.plant ? `Plant: ${r.plant}` : '',
    `Problem: ${stripHtml(r.description || '').slice(0, 1500)}`,
    resolution ? `Resolution notes: ${resolution.slice(0, 1500)}` : '',
  ].filter(Boolean).join('\n');
}

/**
 * (Re)index all resolved/closed tickets for a tenant.
 * Skips tickets whose record hasn't changed since last indexing.
 */
export async function indexResolvedTickets(tenantId: string) {
  const records = await prisma.iTSMRecord.findMany({
    where: { tenantId, status: { in: ['RESOLVED', 'CLOSED'] } },
    select: {
      id: true, recordNumber: true, recordType: true, priority: true,
      title: true, description: true, plant: true, updatedAt: true,
      sapModule: { select: { name: true } },
      comments: {
        select: { text: true, internalFlag: true, deletedAt: true },
        orderBy: { createdAt: 'asc' },
      },
    },
  });

  const existing = await prisma.ticketEmbedding.findMany({
    where: { tenantId },
    select: { recordId: true, sourceUpdatedAt: true },
  });
  const existingMap = new Map(existing.map((e) => [e.recordId, e.sourceUpdatedAt.getTime()]));

  let indexed = 0, skipped = 0, failed = 0;
  for (const r of records) {
    if (existingMap.get(r.id) === r.updatedAt.getTime()) { skipped++; continue; }
    try {
      const content = buildTicketContent(r);
      const embedding = await embedText(content);
      await prisma.ticketEmbedding.upsert({
        where: { recordId: r.id },
        create: { tenantId, recordId: r.id, content, embedding, sourceUpdatedAt: r.updatedAt },
        update: { content, embedding, sourceUpdatedAt: r.updatedAt },
      });
      indexed++;
    } catch (err: any) {
      failed++;
      logger.warn(`RAG index failed for ${r.recordNumber}: ${err.message}`);
    }
  }

  logger.info(`RAG index complete: ${indexed} indexed, ${skipped} unchanged, ${failed} failed (tenant ${tenantId})`);
  return { total: records.length, indexed, skipped, failed };
}

export interface SimilarTicket {
  recordId: string;
  similarity: number;
  content: string;
}

/**
 * Semantic search over indexed tickets. Returns top-K above a relevance floor.
 */
export async function findSimilarTickets(
  tenantId: string,
  queryText: string,
  topK = 5,
  excludeRecordId?: string,
): Promise<SimilarTicket[]> {
  const rows = await prisma.ticketEmbedding.findMany({
    where: { tenantId, ...(excludeRecordId && { recordId: { not: excludeRecordId } }) },
    select: { recordId: true, content: true, embedding: true },
  });
  if (!rows.length) return [];

  const queryVec = await embedText(queryText);
  return rows
    .map((r) => ({
      recordId: r.recordId,
      content: r.content,
      similarity: cosine(queryVec, r.embedding as unknown as number[]),
    }))
    .filter((r) => r.similarity > 0.55)
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, topK);
}
