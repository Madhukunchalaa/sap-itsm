import { prisma } from '../config/database';
import { logger } from '../config/logger';

// ---------------------------------------------------------------------------
// Lexical similarity — keyless fallback for ticket matching.
//
// Embeds resolved/closed tickets as hashed TF-IDF vectors (pure JS, no
// external model or API key) and matches query text with cosine similarity.
// Complements rag.service.ts: RAG (Gemini embeddings) gives better semantic
// matches but needs GEMINI_API_KEY; this works with zero external calls, so
// the assistant's suggestions never go dark. Index is per tenant, held in
// memory, rebuilt lazily every INDEX_TTL_MS.
// ---------------------------------------------------------------------------

const VECTOR_DIM = 512;
const MAX_INDEX_DOCS = 1500;              // most recent resolved tickets per tenant
const INDEX_TTL_MS = 6 * 60 * 60 * 1000;  // rebuild after 6h
const RESOLUTION_ROLES = ['AGENT', 'SUPER_ADMIN', 'PROJECT_MANAGER'];

const STOPWORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'but', 'if', 'then', 'else', 'when', 'while',
  'is', 'are', 'was', 'were', 'be', 'been', 'being', 'am', 'do', 'does', 'did',
  'have', 'has', 'had', 'having', 'will', 'would', 'shall', 'should', 'can',
  'could', 'may', 'might', 'must', 'to', 'of', 'in', 'on', 'at', 'by', 'for',
  'with', 'about', 'into', 'through', 'during', 'before', 'after', 'from',
  'up', 'down', 'out', 'off', 'over', 'under', 'again', 'this', 'that',
  'these', 'those', 'it', 'its', 'we', 'our', 'you', 'your', 'they', 'their',
  'he', 'she', 'his', 'her', 'i', 'me', 'my', 'us', 'them', 'as', 'so', 'not',
  'no', 'nor', 'too', 'very', 'just', 'also', 'there', 'here', 'what', 'which',
  'who', 'whom', 'how', 'why', 'where', 'all', 'any', 'both', 'each', 'few',
  'more', 'most', 'some', 'such', 'only', 'own', 'same', 'than', 'please',
  'kindly', 'hi', 'hello', 'dear', 'team', 'thanks', 'thank', 'regards',
  'getting', 'facing', 'issue', 'problem', 'error', 'help', 'need', 'unable',
]);

export interface LexicalMatch {
  recordId: string;
  recordNumber: string;
  title: string;
  status: string;
  priority: string;
  sapModuleCode: string | null;
  sapModuleName: string | null;
  resolutionHint: string | null;
  score: number; // 0..1 cosine similarity
}

interface IndexedTicket extends Omit<LexicalMatch, 'score'> {
  vector: Float32Array;
}

interface TenantIndex {
  builtAt: number;
  docCount: number;
  df: Map<string, number>; // document frequency per token
  tickets: IndexedTicket[];
}

const indexCache = new Map<string, TenantIndex>();
const buildLocks = new Map<string, Promise<TenantIndex>>();

// Comments/descriptions come from a rich-text editor and contain HTML
export function stripHtml(s: string): string {
  return (s || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#\d+;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9/_.-]+/g, ' ')
    .split(/\s+/)
    .map(t => t.replace(/^[/_.-]+|[/_.-]+$/g, ''))
    .filter(t => t.length >= 2 && t.length <= 30 && !STOPWORDS.has(t) && !/^\d+$/.test(t));
}

function hashToken(token: string, seed: number): number {
  let h = seed;
  for (let i = 0; i < token.length; i++) {
    h = ((h << 5) + h + token.charCodeAt(i)) | 0;
  }
  return h;
}

// Feature-hashed TF-IDF embedding, L2-normalized so cosine = dot product
function embed(tokens: string[], df: Map<string, number>, docCount: number): Float32Array {
  const tf = new Map<string, number>();
  for (const t of tokens) tf.set(t, (tf.get(t) || 0) + 1);

  const vec = new Float32Array(VECTOR_DIM);
  for (const [token, count] of tf) {
    const idf = Math.log((docCount + 1) / ((df.get(token) || 0) + 1)) + 1;
    const weight = (1 + Math.log(count)) * idf;
    const idx = Math.abs(hashToken(token, 5381)) % VECTOR_DIM;
    const sign = (hashToken(token, 52711) & 1) === 1 ? 1 : -1;
    vec[idx] += sign * weight;
  }

  let norm = 0;
  for (let i = 0; i < VECTOR_DIM; i++) norm += vec[i] * vec[i];
  norm = Math.sqrt(norm);
  if (norm > 0) for (let i = 0; i < VECTOR_DIM; i++) vec[i] /= norm;

  return vec;
}

function cosine(a: Float32Array, b: Float32Array): number {
  let dot = 0;
  for (let i = 0; i < VECTOR_DIM; i++) dot += a[i] * b[i];
  return dot;
}

async function buildIndex(tenantId: string): Promise<TenantIndex> {
  const started = Date.now();

  const records = await prisma.iTSMRecord.findMany({
    where: { tenantId, status: { in: ['RESOLVED', 'CLOSED'] } },
    orderBy: { updatedAt: 'desc' },
    take: MAX_INDEX_DOCS,
    select: {
      id: true,
      recordNumber: true,
      title: true,
      description: true,
      status: true,
      priority: true,
      sapModule: { select: { code: true, name: true } },
      comments: {
        where: { author: { role: { in: RESOLUTION_ROLES as any } } },
        orderBy: { createdAt: 'desc' },
        take: 2,
        select: { text: true },
      },
    },
  });

  // Pass 1: tokenize + document frequencies
  const docs = records.map(r => {
    // Title weighted 2x — it's the strongest signal
    const text = `${r.title} ${r.title} ${stripHtml(r.description || '').slice(0, 4000)}`;
    return { record: r, tokens: tokenize(text) };
  });

  const df = new Map<string, number>();
  for (const doc of docs) {
    for (const token of new Set(doc.tokens)) {
      df.set(token, (df.get(token) || 0) + 1);
    }
  }

  // Pass 2: embed
  const tickets: IndexedTicket[] = docs.map(({ record, tokens }) => ({
    recordId: record.id,
    recordNumber: record.recordNumber,
    title: record.title,
    status: record.status,
    priority: record.priority,
    sapModuleCode: record.sapModule?.code || null,
    sapModuleName: record.sapModule?.name || null,
    resolutionHint: record.comments[0]?.text ? stripHtml(record.comments[0].text).slice(0, 300) : null,
    vector: embed(tokens, df, docs.length),
  }));

  const index: TenantIndex = { builtAt: Date.now(), docCount: docs.length, df, tickets };
  logger.info(`[LexicalSim] Index built for tenant ${tenantId}: ${tickets.length} tickets in ${Date.now() - started}ms`);
  return index;
}

async function getIndex(tenantId: string): Promise<TenantIndex> {
  const cached = indexCache.get(tenantId);
  if (cached && Date.now() - cached.builtAt < INDEX_TTL_MS) return cached;

  // Build lock prevents concurrent rebuild stampede
  let lock = buildLocks.get(tenantId);
  if (!lock) {
    lock = buildIndex(tenantId)
      .then(index => { indexCache.set(tenantId, index); return index; })
      .finally(() => buildLocks.delete(tenantId));
    buildLocks.set(tenantId, lock);
  }
  return lock;
}

export function invalidateLexicalIndex(tenantId: string): void {
  indexCache.delete(tenantId);
}

export async function findSimilarTicketsLexical(
  tenantId: string,
  text: string,
  options: { topK?: number; minScore?: number; excludeRecordId?: string } = {}
): Promise<LexicalMatch[]> {
  const { topK = 5, minScore = 0.2, excludeRecordId } = options;

  const index = await getIndex(tenantId);
  if (index.tickets.length === 0) return [];

  const queryVec = embed(tokenize(stripHtml(text)), index.df, index.docCount);

  const scored: LexicalMatch[] = [];
  for (const t of index.tickets) {
    if (excludeRecordId && t.recordId === excludeRecordId) continue;
    const score = cosine(queryVec, t.vector);
    if (score >= minScore) {
      const { vector, ...rest } = t;
      scored.push({ ...rest, score: Math.round(score * 100) / 100 });
    }
  }

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, topK);
}
