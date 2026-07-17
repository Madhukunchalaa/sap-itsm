import { Priority } from '@prisma/client';
import { prisma } from '../config/database';
import { cache } from '../config/redis';
import { logger } from '../config/logger';
import { findSimilarTicketsLexical, LexicalMatch, stripHtml } from './similarity.service';
import { scoreAgents } from './assignment.service';

// ---------------------------------------------------------------------------
// Deterministic triage — keyless AI suggestions for tickets.
//
// Complements the LLM triage in chat.service.ts (generateTriage): this one
// needs no API key and runs automatically on every ticket creation.
// Combines:
//  - priority heuristics (keyword signals)
//  - SAP module detection (master-data keyword match + similar-ticket votes)
//  - agent recommendations (reuses the assignment scoring engine)
//  - similar resolved tickets (RAG when GEMINI_API_KEY works, lexical fallback)
//
// Output goes to record.metadata.aiTriage + an internal comment, and is
// served fresh via GET /records/:id/suggestions.
// ---------------------------------------------------------------------------

interface PrioritySignal {
  priority: Priority;
  pattern: RegExp;
  label: string;
}

const PRIORITY_SIGNALS: PrioritySignal[] = [
  // P1 — critical / business stopped
  { priority: 'P1', pattern: /\b(prod|production|live)\b[^.]{0,40}\bdown\b/i, label: 'production down' },
  { priority: 'P1', pattern: /\bsystem\s+(is\s+)?down\b/i, label: 'system down' },
  { priority: 'P1', pattern: /\boutage\b/i, label: 'outage' },
  { priority: 'P1', pattern: /\ball\s+users\b/i, label: 'all users affected' },
  { priority: 'P1', pattern: /\bdata\s+loss\b/i, label: 'data loss' },
  { priority: 'P1', pattern: /\bsecurity\s+(breach|incident)\b/i, label: 'security breach' },
  { priority: 'P1', pattern: /\b(business|operations?)\s+(stopped|halted|blocked)\b/i, label: 'business stopped' },
  { priority: 'P1', pattern: /\bgo[- ]?live\b[^.]{0,40}\b(blocked|failed|at risk)\b/i, label: 'go-live blocked' },
  { priority: 'P1', pattern: /\bcannot\s+(log\s?in|login|access)\b[^.]{0,40}\b(any|all|entire)\b/i, label: 'widespread access failure' },
  // P2 — high / urgent
  { priority: 'P2', pattern: /\burgent(ly)?\b/i, label: 'urgent' },
  { priority: 'P2', pattern: /\bcritical\b/i, label: 'critical' },
  { priority: 'P2', pattern: /\bescalat(e|ion)\b/i, label: 'escalation requested' },
  { priority: 'P2', pattern: /\b(many|multiple|several)\s+users\b/i, label: 'multiple users affected' },
  { priority: 'P2', pattern: /\b(month|year|quarter)[- ]?end\b/i, label: 'period-end deadline' },
  { priority: 'P2', pattern: /\bpayroll\b/i, label: 'payroll impact' },
  { priority: 'P2', pattern: /\bdeadline\b/i, label: 'deadline mentioned' },
  { priority: 'P2', pattern: /\basap\b/i, label: 'ASAP' },
  // P4 — low / cosmetic
  { priority: 'P4', pattern: /\bcosmetic\b/i, label: 'cosmetic' },
  { priority: 'P4', pattern: /\btypo\b/i, label: 'typo' },
  { priority: 'P4', pattern: /\bnice\s+to\s+have\b/i, label: 'nice to have' },
  { priority: 'P4', pattern: /\b(no|low)\s+(rush|urgency|priority)\b/i, label: 'low urgency stated' },
  { priority: 'P4', pattern: /\bwhenever\s+(you|possible)\b/i, label: 'no deadline' },
  { priority: 'P4', pattern: /\bhow\s+(do|to|can)\b/i, label: 'how-to question' },
  { priority: 'P4', pattern: /\btraining\b/i, label: 'training request' },
];

const PRIORITY_RANK: Record<Priority, number> = { P1: 1, P2: 2, P3: 3, P4: 4 };

export interface TriageSuggestions {
  generatedAt: string;
  priority: {
    suggested: Priority;
    current: Priority | null;
    mismatch: boolean;
    signals: string[];
    confidence: 'low' | 'medium' | 'high';
  };
  module: {
    current: string | null; // current sapModuleId
    suggestions: Array<{ sapModuleId: string; code: string; name: string; score: number }>;
  };
  agents: Array<{
    agentId: string;
    agentName: string;
    level: string;
    status: string;
    openTickets: number;
    maxConcurrent: number;
    totalScore: number;
    reasons: string[];
  }>;
  similarTickets: LexicalMatch[];
  similarSource: 'rag' | 'lexical' | 'none';
}

export interface TriageInput {
  tenantId: string;
  recordId?: string;
  title: string;
  description: string;
  recordType?: string;
  priority?: Priority | null;
  customerId?: string | null;
  sapModuleId?: string | null;
  sapSubModuleId?: string | null;
  assignedAgentId?: string | null;
}

function suggestPriority(text: string, current: Priority | null) {
  const matched = PRIORITY_SIGNALS.filter(s => s.pattern.test(text));

  // Strongest (lowest-rank) signal wins; default P3
  let suggested: Priority = 'P3';
  const signals: string[] = [];
  if (matched.length > 0) {
    matched.sort((a, b) => PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority]);
    suggested = matched[0].priority;
    for (const m of matched) {
      if (m.priority === suggested) signals.push(m.label);
    }
  }

  const confidence: 'low' | 'medium' | 'high' =
    signals.length >= 2 ? 'high' : signals.length === 1 ? 'medium' : 'low';

  return {
    suggested,
    current,
    mismatch: current !== null && confidence !== 'low' && suggested !== current,
    signals,
    confidence,
  };
}

// Similar resolved tickets: RAG (semantic) when the Gemini key + index are
// available, lexical TF-IDF otherwise — suggestions never go fully dark.
async function getSimilarTickets(
  tenantId: string,
  text: string,
  excludeRecordId?: string
): Promise<{ tickets: LexicalMatch[]; source: 'rag' | 'lexical' | 'none' }> {
  try {
    const rag = await import('./rag.service');
    const sims = await rag.findSimilarTickets(tenantId, text, 5, excludeRecordId);
    if (sims.length > 0) {
      const ids = sims.map(s => s.recordId);
      const recs = await prisma.iTSMRecord.findMany({
        where: { id: { in: ids } },
        select: {
          id: true, recordNumber: true, title: true, status: true, priority: true,
          sapModule: { select: { code: true, name: true } },
        },
      });
      const tickets = sims
        .map(s => {
          const r = recs.find(x => x.id === s.recordId);
          if (!r) return null;
          // rag content ends with "Resolution notes: …" when comments existed
          const hintMatch = s.content.match(/Resolution notes:\s*([\s\S]+)$/);
          return {
            recordId: r.id,
            recordNumber: r.recordNumber,
            title: r.title,
            status: r.status,
            priority: r.priority,
            sapModuleCode: r.sapModule?.code || null,
            sapModuleName: r.sapModule?.name || null,
            resolutionHint: hintMatch ? hintMatch[1].slice(0, 300) : null,
            score: Math.round(s.similarity * 100) / 100,
          } as LexicalMatch;
        })
        .filter((t): t is LexicalMatch => t !== null);
      if (tickets.length > 0) return { tickets, source: 'rag' };
    }
  } catch (err: any) {
    logger.warn(`[Triage] RAG unavailable (${err.message}) — using lexical similarity`);
  }

  const tickets = await findSimilarTicketsLexical(tenantId, text, { topK: 5, excludeRecordId });
  return { tickets, source: tickets.length > 0 ? 'lexical' : 'none' };
}

async function suggestModules(
  tenantId: string,
  text: string,
  similar: LexicalMatch[],
  currentModuleId: string | null
) {
  const modules = await prisma.sAPModuleMaster.findMany({
    where: { tenantId, isActive: true },
    select: {
      id: true, code: true, name: true,
      subModules: { where: { isActive: true }, select: { code: true, name: true } },
    },
  });

  const lower = ` ${text.toLowerCase()} `;
  const scores = new Map<string, number>();

  const wordHit = (needle: string) =>
    new RegExp(`\\b${needle.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(lower);

  for (const m of modules) {
    let score = 0;
    if (wordHit(m.code)) score += 3;
    // Name tokens (skip generic words)
    for (const word of m.name.split(/\s+/)) {
      if (word.length >= 4 && wordHit(word)) score += 1;
    }
    for (const sm of m.subModules) {
      if (wordHit(sm.code)) score += 2;
      for (const word of sm.name.split(/\s+/)) {
        if (word.length >= 4 && wordHit(word)) score += 0.5;
      }
    }
    if (score > 0) scores.set(m.id, score);
  }

  // Votes from similar resolved tickets — strong empirical signal
  for (const s of similar) {
    if (!s.sapModuleCode) continue;
    const mod = modules.find(m => m.code === s.sapModuleCode);
    if (mod) scores.set(mod.id, (scores.get(mod.id) || 0) + s.score * 4);
  }

  const suggestions = [...scores.entries()]
    .map(([id, score]) => {
      const m = modules.find(x => x.id === id)!;
      return { sapModuleId: id, code: m.code, name: m.name, score: Math.round(score * 10) / 10 };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, 2);

  return { current: currentModuleId, suggestions };
}

async function suggestAgents(input: TriageInput) {
  if (!input.customerId) return [];

  try {
    const scores = await scoreAgents({
      tenantId: input.tenantId,
      customerId: input.customerId,
      priority: input.priority || 'P3',
      sapModuleId: input.sapModuleId,
      sapSubModuleId: input.sapSubModuleId,
    });

    return scores
      .filter(s => s.status !== 'OFFLINE' && s.openTickets < s.maxConcurrent)
      .slice(0, 3)
      .map(s => {
        const reasons: string[] = [];
        if (s.moduleMatch > 0) reasons.push('module specialization match');
        if (s.subModuleMatch > 0) reasons.push('sub-module match');
        if (s.levelScore >= 20) reasons.push(`${s.level} fits ${input.priority || 'P3'}`);
        if (s.workloadScore >= 10) reasons.push(`light workload (${s.openTickets}/${s.maxConcurrent})`);
        if (s.availabilityScore >= 10) reasons.push('available now');
        return {
          agentId: s.agentId,
          agentName: s.agentName,
          level: s.level,
          status: s.status,
          openTickets: s.openTickets,
          maxConcurrent: s.maxConcurrent,
          totalScore: s.totalScore,
          reasons,
        };
      });
  } catch (err) {
    logger.error('[Triage] Agent suggestion failed:', err);
    return [];
  }
}

export async function buildTriageSuggestions(input: TriageInput): Promise<TriageSuggestions> {
  const text = `${input.title}\n${stripHtml(input.description || '').slice(0, 4000)}`;

  const { tickets: similarTickets, source: similarSource } = await getSimilarTickets(
    input.tenantId, text, input.recordId
  );

  const [moduleSuggestion, agents] = await Promise.all([
    suggestModules(input.tenantId, text, similarTickets, input.sapModuleId || null),
    suggestAgents(input),
  ]);

  return {
    generatedAt: new Date().toISOString(),
    priority: suggestPriority(text, input.priority || null),
    module: moduleSuggestion,
    agents,
    similarTickets,
    similarSource,
  };
}

function formatTriageComment(t: TriageSuggestions): string {
  const lines: string[] = ['🤖 AI Triage (automated suggestions)', ''];

  if (t.priority.mismatch) {
    lines.push(
      `• Priority check: suggests ${t.priority.suggested} (current ${t.priority.current}) — signals: ${t.priority.signals.join(', ')}`
    );
  }

  if (t.module.suggestions.length > 0 && !t.module.current) {
    const top = t.module.suggestions[0];
    lines.push(`• Likely SAP module: ${top.code} — ${top.name}`);
  }

  if (t.agents.length > 0) {
    const names = t.agents
      .map(a => `${a.agentName} (${a.level}, ${a.openTickets}/${a.maxConcurrent} open)`)
      .join(', ');
    lines.push(`• Recommended agents: ${names}`);
  }

  if (t.similarTickets.length > 0) {
    lines.push('• Similar resolved tickets:');
    for (const s of t.similarTickets.slice(0, 3)) {
      const pct = Math.round(s.score * 100);
      lines.push(`   – ${s.recordNumber} "${s.title}" (${pct}% match)`);
      if (s.resolutionHint) {
        lines.push(`     ↳ ${s.resolutionHint.replace(/\s+/g, ' ').slice(0, 180)}`);
      }
    }
  }

  return lines.join('\n');
}

// Fire-and-forget after ticket creation. Never throws.
export async function runAutoTriage(record: {
  id: string;
  tenantId: string;
  title: string;
  description: string;
  recordType: string;
  priority: Priority;
  customerId?: string | null;
  sapModuleId?: string | null;
  sapSubModuleId?: string | null;
  assignedAgentId?: string | null;
  metadata?: unknown;
  createdBy: { id: string };
}): Promise<void> {
  try {
    const triage = await buildTriageSuggestions({
      tenantId: record.tenantId,
      recordId: record.id,
      title: record.title,
      description: record.description,
      recordType: record.recordType,
      priority: record.priority,
      customerId: record.customerId,
      sapModuleId: record.sapModuleId,
      sapSubModuleId: record.sapSubModuleId,
      assignedAgentId: record.assignedAgentId,
    });

    // Persist on the record for the suggestions endpoint / frontend
    const existingMeta = (record.metadata as Record<string, unknown>) || {};
    await prisma.iTSMRecord.update({
      where: { id: record.id },
      data: { metadata: { ...existingMeta, aiTriage: triage } as any },
    });

    // Post an internal comment only when there is something actionable —
    // agents see it in the existing comment UI; end users never do.
    const worthPosting =
      triage.similarTickets.length > 0 ||
      triage.priority.mismatch ||
      (triage.module.suggestions.length > 0 && !record.sapModuleId) ||
      (triage.agents.length > 0 && !record.assignedAgentId);

    if (worthPosting) {
      await prisma.comment.create({
        data: {
          recordId: record.id,
          // Attributed to the creator technically; text is clearly marked as automated
          authorId: record.createdBy.id,
          text: formatTriageComment(triage),
          internalFlag: true,
        },
      });
    }

    await cache.del(cache.key.record(record.id));
    logger.info(`[Triage] Auto-triage completed for ${record.id} (source: ${triage.similarSource}, comment: ${worthPosting})`);
  } catch (err) {
    logger.error('[Triage] Auto-triage failed:', err);
  }
}
