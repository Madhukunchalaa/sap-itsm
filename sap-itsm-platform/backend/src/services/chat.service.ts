import Anthropic from '@anthropic-ai/sdk';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { listRecords, getRecord } from './record.service';
import { findSimilarTickets } from './rag.service';
import { AppError } from '../utils/AppError';
import { prisma } from '../config/database';
import { getKnowledge } from './knowledge.service';
import { logger } from '../config/logger';

// ---------------------------------------------------------------------------
// SAP ITSM AI Assistant — READ-ONLY chatbot + AI triage.
//
// Provider is selectable via AI_PROVIDER:
//   'gemini' (default) — free tier, uses GEMINI_API_KEY
//   'claude'           — best quality, uses ANTHROPIC_API_KEY (paid)
// The tools, prompts, and behavior are identical across providers; only the
// LLM call differs. Nothing here ever writes to a ticket.
// ---------------------------------------------------------------------------
const AI_PROVIDER = (process.env.AI_PROVIDER || 'gemini').toLowerCase();
const CLAUDE_MODEL = 'claude-opus-4-8';
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
const MAX_TOOL_ROUNDS = 4;

const STATUS_ENUM = [
  'NEW', 'OPEN', 'IN_PROGRESS', 'PENDING', 'AWAITING_CUSTOMER',
  'WITH_SAP', 'REOPEN', 'RESOLVED', 'CLOSED', 'CANCELLED',
];
const PRIORITY_ENUM = ['P1', 'P2', 'P3', 'P4'];
const TYPE_ENUM = ['INCIDENT', 'REQUEST', 'PROBLEM', 'CHANGE'];

// ---- Read-only tool definitions (JSON-schema; works for both providers) ----
const TOOL_DEFS = [
  {
    name: 'list_tickets',
    description:
      'Search and list ITSM tickets with optional filters. Returns the total ' +
      'match count plus a page of summaries. Use this for "how many…", "show me…", ' +
      'or "list…" questions. All filters are optional and combine with AND.',
    parameters: {
      type: 'object',
      properties: {
        status: { type: 'array', items: { type: 'string', enum: STATUS_ENUM }, description: 'Filter by one or more statuses' },
        priority: { type: 'array', items: { type: 'string', enum: PRIORITY_ENUM }, description: 'Filter by one or more priorities' },
        recordType: { type: 'array', items: { type: 'string', enum: TYPE_ENUM }, description: 'Filter by one or more record types' },
        plant: { type: 'string', description: 'Exact plant name, e.g. "2121 - Anpara"' },
        search: { type: 'string', description: 'Free-text search over title, description, record number, and SAP module' },
        mine: { type: 'boolean', description: 'If true, only tickets created by the current user' },
        limit: { type: 'number', description: 'Max summaries to return (1-25, default 10). The total count is always exact.' },
      },
    },
  },
  {
    name: 'get_ticket',
    description: 'Get the full detail of a single ticket by its record number (e.g. "INC-2024-0001") or UUID, including comments.',
    parameters: {
      type: 'object',
      properties: { ticket: { type: 'string', description: 'Record number or UUID of the ticket' } },
      required: ['ticket'],
    },
  },
  {
    name: 'list_agents',
    description: 'List support agents with their level, specialization, and availability status.',
    parameters: {
      type: 'object',
      properties: { level: { type: 'string', enum: ['L1', 'L2', 'L3', 'SPECIALIST'], description: 'Optional: filter by agent level' } },
    },
  },
  {
    name: 'find_similar_tickets',
    description:
      'Semantic search over past RESOLVED/CLOSED tickets and their resolution notes. ' +
      'Use when the user describes a problem and wants a known solution, or asks ' +
      '"have we seen this before?". Returns the most similar past tickets including how they were resolved.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Description of the problem to match against past tickets' },
      },
      required: ['query'],
    },
  },
];

// ---- Tool executors (all read-only) ---------------------------------------
function summarizeTicket(r: any) {
  return {
    ticket: r.recordNumber,
    type: r.recordType,
    priority: r.priority,
    status: r.status,
    title: r.title,
    plant: r.plant || null,
    module: r.sapModule?.name || null,
    agent: r.assignedAgent?.user
      ? `${r.assignedAgent.user.firstName} ${r.assignedAgent.user.lastName || ''}`.trim()
      : null,
    customer: r.customer?.companyName || null,
    createdAt: r.createdAt,
  };
}

async function runTool(name: string, input: any, ctx: { tenantId: string; userId: string }) {
  input = input || {};
  switch (name) {
    case 'list_tickets': {
      const res = await listRecords({
        tenantId: ctx.tenantId,
        page: 1,
        limit: Math.min(Math.max(input.limit || 10, 1), 25),
        ...(input.status?.length && { statusIn: input.status }),
        ...(input.priority?.length && { priorityIn: input.priority }),
        ...(input.recordType?.length && { recordTypeIn: input.recordType }),
        ...(input.plant && { plant: input.plant }),
        ...(input.search && { search: input.search }),
        ...(input.mine && { createdById: ctx.userId }),
      } as any);
      return { total: res.pagination.total, showing: res.data.length, tickets: (res.data as any[]).map(summarizeTicket) };
    }
    case 'get_ticket': {
      let id: string = String(input.ticket || '').trim();
      const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
      if (!isUuid) {
        const found = await listRecords({ tenantId: ctx.tenantId, page: 1, limit: 1, search: id } as any);
        if (!found.data.length) return { error: `No ticket found matching "${input.ticket}".` };
        id = (found.data[0] as any).id;
      }
      const rec = await getRecord(id, ctx.tenantId);
      return rec || { error: 'Ticket not found.' };
    }
    case 'list_agents': {
      const agents = await prisma.agent.findMany({
        where: { user: { tenantId: ctx.tenantId }, ...(input.level && { level: input.level }) },
        include: { user: { select: { firstName: true, lastName: true } } },
      });
      return agents.map((a) => ({
        name: `${a.user.firstName} ${a.user.lastName || ''}`.trim(),
        level: a.level,
        specialization: a.specialization,
        status: a.status,
      }));
    }
    case 'find_similar_tickets': {
      const sims = await findSimilarTickets(ctx.tenantId, String(input.query || ''), 5);
      if (!sims.length) {
        return { info: 'No similar past tickets found (the RAG index may be empty — a Super Admin can rebuild it via the AI train action).' };
      }
      return sims.map((s) => ({ relevance: Number(s.similarity.toFixed(2)), details: s.content }));
    }
    default:
      return { error: `Unknown tool: ${name}` };
  }
}

// ---- Shared context (system prompt with live knowledge snapshot) ----------
async function buildSystemPrompt(tenantId: string, userName: string) {
  const knowledge = await getKnowledge(tenantId);
  const knowledgeContext = knowledge
    ? `
CURRENT SYSTEM SNAPSHOT (as of ${new Date(knowledge.updatedAt).toLocaleString()}):
- Active SAP Modules: ${knowledge.sapModules.map((m: any) => `${m.name} (${m.code})`).join(', ')}
- Support Agents: ${knowledge.agents.map((a: any) => `${a.name} (${a.level}, ${a.status})`).join(', ')}
- Top Customers: ${knowledge.customers.join(', ')}
- Recent Ticket Stats: ${knowledge.recentStats.map((s: any) => `${s.recordType} ${s.status}: ${s._count}`).join(', ')}`
    : '';

  return `You are the SAP ITSM AI Assistant, a friendly and knowledgeable L1/L2 support expert.
You are talking to ${userName}.

WHAT YOU CAN DO:
- Answer questions about tickets by calling the read-only tools (list_tickets, get_ticket, list_agents).
- ANALYZE tickets and PROPOSE SOLUTIONS. This is your core job: when asked for a solution, fix, or analysis of a ticket, call get_ticket first, then call find_similar_tickets with the problem description to check how similar past tickets were resolved, then give (1) the likely root cause, (2) concrete step-by-step resolution an SAP L2 engineer could follow — citing the past ticket (e.g. "as done in REQ-2026-0041") when a precedent matches, and (3) relevant SAP T-codes. Never refuse to suggest a solution — suggesting is always allowed.
- Search resolution history: when the user describes any problem, use find_similar_tickets to surface how similar issues were solved before.
- Help with general SAP and ITSM "how do I…" questions: T-codes, root causes, troubleshooting steps.

RULES:
- You cannot MODIFY anything in the system — no creating, editing, commenting, assigning, or closing tickets. If asked to perform a change, explain the user must do it in the app (e.g. via Edit or + New Ticket). This restriction applies ONLY to changing data. Giving advice, analysis, and solution proposals is always in scope and encouraged.
- Always use a tool to get live data — never guess ticket counts, statuses, or details. For "how many" questions, call list_tickets with the right filters and report the exact total.
- Keep answers short and readable: use bold, bullet points, and spacing. No walls of text.
- When the user describes an error or SAP issue, proactively offer 1-2 troubleshooting ideas or relevant T-codes.
- If you need a filter the user didn't give (e.g. which plant), ask a brief clarifying question.
${knowledgeContext}`;
}

// ===========================================================================
// CLAUDE chat loop
// ===========================================================================
async function runClaudeChat(systemPrompt: string, priorMessages: Anthropic.MessageParam[], ctx: { tenantId: string; userId: string }) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey || apiKey === 'YOUR_CLAUDE_API_KEY_HERE') {
    throw new AppError('Anthropic API key is not configured. Set ANTHROPIC_API_KEY or switch AI_PROVIDER=gemini.', 500);
  }
  const anthropic = new Anthropic({ apiKey });
  const tools: Anthropic.Tool[] = TOOL_DEFS.map((t) => ({ name: t.name, description: t.description, input_schema: t.parameters as any }));
  const messages = [...priorMessages];

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const response = await anthropic.messages.create({
      model: CLAUDE_MODEL, max_tokens: 1500, system: systemPrompt, tools, messages,
    });
    if (response.stop_reason === 'tool_use') {
      messages.push({ role: 'assistant', content: response.content });
      const toolResults: Anthropic.ToolResultBlockParam[] = [];
      for (const block of response.content) {
        if (block.type === 'tool_use') {
          let result: any;
          try { result = await runTool(block.name, block.input, ctx); }
          catch (err: any) { result = { error: err.message || 'Tool execution failed' }; }
          toolResults.push({ type: 'tool_result', tool_use_id: block.id, content: JSON.stringify(result) });
        }
      }
      messages.push({ role: 'user', content: toolResults });
      continue;
    }
    return response.content.filter((b) => b.type === 'text').map((b: any) => b.text).join('\n').trim();
  }
  return '';
}

// ===========================================================================
// GEMINI chat loop
// ===========================================================================
function toGeminiHistory(history: any[]) {
  const raw = history
    .map((h) => ({
      role: h.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: typeof h.content === 'string' ? h.content : Array.isArray(h.content) ? h.content.map((c: any) => c.text || '').join('') : String(h.content ?? '') }],
    }))
    .filter((h) => h.parts[0].text.trim() !== '');
  const out: any[] = [];
  for (const m of raw) {
    if (out.length === 0) { if (m.role === 'user') out.push(m); }
    else if (out[out.length - 1].role === m.role) out[out.length - 1].parts[0].text += '\n' + m.parts[0].text;
    else out.push(m);
  }
  return out;
}

async function runGeminiChat(systemPrompt: string, history: any[], message: string, ctx: { tenantId: string; userId: string }) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey === 'YOUR_GEMINI_API_KEY_HERE') {
    throw new AppError('Gemini API key is not configured. Add GEMINI_API_KEY to your .env file.', 500);
  }
  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({
    model: GEMINI_MODEL,
    tools: [{ functionDeclarations: TOOL_DEFS as any }],
    systemInstruction: { role: 'system', parts: [{ text: systemPrompt }] } as any,
  });

  const chat = model.startChat({ history: toGeminiHistory(history) });
  let result = await chat.sendMessage(message);

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const calls = result.response.functionCalls();
    if (!calls || calls.length === 0) break;
    const responses: any[] = [];
    for (const call of calls) {
      let out: any;
      try { out = await runTool(call.name, call.args as any, ctx); }
      catch (err: any) { out = { error: err.message || 'Tool execution failed' }; }
      responses.push({ functionResponse: { name: call.name, response: Array.isArray(out) ? { data: out } : out } });
    }
    result = await chat.sendMessage(responses);
  }

  try { return result.response.text(); }
  catch { return 'I processed that, but had trouble writing a reply — could you rephrase?'; }
}

// ---- Main chat entry point -------------------------------------------------
export async function processChatMessage(tenantId: string, userId: string, message: string, history: any[] = []) {
  const userRecord = await prisma.user.findUnique({ where: { id: userId }, select: { firstName: true, lastName: true } });
  const userName = userRecord ? `${userRecord.firstName} ${userRecord.lastName || ''}`.trim() : 'there';
  const systemPrompt = await buildSystemPrompt(tenantId, userName);

  try {
    let finalText: string;
    if (AI_PROVIDER === 'claude') {
      const priorMessages: Anthropic.MessageParam[] = history
        .map((h) => ({
          role: h.role === 'assistant' ? 'assistant' : 'user',
          content: typeof h.content === 'string' ? h.content : Array.isArray(h.content) ? h.content.map((c: any) => c.text || '').join('') : String(h.content ?? ''),
        } as Anthropic.MessageParam))
        .filter((m) => typeof m.content === 'string' && (m.content as string).trim() !== '');
      priorMessages.push({ role: 'user', content: message });
      finalText = await runClaudeChat(systemPrompt, priorMessages, { tenantId, userId });
    } else {
      finalText = await runGeminiChat(systemPrompt, history, message, { tenantId, userId });
    }

    if (!finalText) finalText = "I looked into that but couldn't put together a clear answer — could you rephrase?";

    return {
      message: finalText,
      history: [
        ...history,
        { role: 'user', content: message },
        { role: 'assistant', content: [{ type: 'text', text: finalText }] },
      ],
    };
  } catch (error: any) {
    logger.error('AI chat error:', { provider: AI_PROVIDER, message: error.message, status: error.status });
    throw new AppError(`AI Service Error: ${error.message || 'Unknown error'}`, 500);
  }
}

// ===========================================================================
// AI TRIAGE — analyze one ticket, propose diagnosis + solution + best agent.
// Suggestion only; never writes. Works with either provider.
// ===========================================================================
export interface TriageResult {
  rootCause: string;
  suggestedSolution: string;
  sapTcodes: string[];
  recommendedAgent: { name: string; reason: string } | null;
  suggestedPriority: string;
  confidence: string;
}

function parseTriage(raw: string, fallbackPriority: string): TriageResult {
  const cleaned = raw.replace(/```json|```/g, '').trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  try {
    const p = JSON.parse(start >= 0 ? cleaned.slice(start, end + 1) : cleaned);
    return {
      rootCause: p.rootCause || '',
      suggestedSolution: p.suggestedSolution || '',
      sapTcodes: Array.isArray(p.sapTcodes) ? p.sapTcodes : [],
      recommendedAgent: p.recommendedAgent?.name ? p.recommendedAgent : null,
      suggestedPriority: p.suggestedPriority || fallbackPriority,
      confidence: p.confidence || 'medium',
    };
  } catch {
    return { rootCause: '', suggestedSolution: raw, sapTcodes: [], recommendedAgent: null, suggestedPriority: fallbackPriority, confidence: 'low' };
  }
}

export async function generateTriage(tenantId: string, recordId: string): Promise<TriageResult> {
  const record: any = await getRecord(recordId, tenantId);
  if (!record) throw new AppError('Ticket not found.', 404);

  const agents = await prisma.agent.findMany({
    where: { user: { tenantId } },
    include: { user: { select: { firstName: true, lastName: true } } },
  });
  const agentList = agents.map((a) => ({
    name: `${a.user.firstName} ${a.user.lastName || ''}`.trim(),
    level: a.level, specialization: a.specialization, status: a.status,
  }));

  // RAG: semantically similar resolved tickets, including their resolution
  // notes — the model grounds its solution in how WE actually fixed these.
  let precedentsBlock = '';
  try {
    const sims = await findSimilarTickets(
      tenantId,
      `${record.title}\n${(record.description || '').replace(/<[^>]*>/g, ' ')}`,
      4,
      record.id,
    );
    if (sims.length) {
      precedentsBlock = sims
        .map((s) => `--- similar past ticket (relevance ${(s.similarity * 100).toFixed(0)}%)\n${s.content}`)
        .join('\n');
    }
  } catch (err: any) {
    logger.warn(`RAG retrieval failed, falling back to module recents: ${err.message}`);
  }
  if (!precedentsBlock) {
    const similar = await listRecords({
      tenantId, page: 1, limit: 5,
      ...(record.sapModuleId && { sapModuleId: record.sapModuleId }),
      statusIn: ['RESOLVED', 'CLOSED'],
    } as any);
    precedentsBlock = (similar.data as any[])
      .filter((r) => r.id !== record.id)
      .map((r) => `- ${r.recordNumber}: ${r.title}`)
      .join('\n') || '- (none)';
  }

  const prompt = `Analyze this SAP ITSM ticket and produce a triage recommendation.

TICKET
- Number: ${record.recordNumber}
- Type: ${record.recordType} | Priority: ${record.priority} | Status: ${record.status}
- Plant: ${record.plant || 'N/A'}
- SAP Module: ${record.sapModule?.name || 'N/A'}${record.sapSubModule?.name ? ' / ' + record.sapSubModule.name : ''}
- Title: ${record.title}
- Description: ${record.description || '(none)'}

AVAILABLE AGENTS (pick the single best match for module + level + availability):
${agentList.map((a) => `- ${a.name} — ${a.level}, ${a.specialization || 'general'}, ${a.status}`).join('\n') || '- (no agents registered)'}

SIMILAR RESOLVED TICKETS from this system (ground your solution in these resolution notes when they match, and cite the ticket number):
${precedentsBlock}

Respond with ONLY a JSON object (no prose, no markdown fences) with exactly these keys:
{
  "rootCause": "1-2 sentences on the most likely root cause",
  "suggestedSolution": "concrete resolution steps an L2 engineer can follow, as short markdown",
  "sapTcodes": ["relevant SAP transaction codes, e.g. ME23N"],
  "recommendedAgent": { "name": "exact name from the agent list", "reason": "why this agent" },
  "suggestedPriority": "P1 | P2 | P3 | P4",
  "confidence": "low | medium | high"
}
If no agent fits, set "recommendedAgent" to null.`;

  const systemInstruction = 'You are a senior SAP ITSM triage expert. You output only valid JSON matching the requested schema.';

  if (AI_PROVIDER === 'claude') {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey || apiKey === 'YOUR_CLAUDE_API_KEY_HERE') {
      throw new AppError('Anthropic API key is not configured. Set ANTHROPIC_API_KEY or switch AI_PROVIDER=gemini.', 500);
    }
    const anthropic = new Anthropic({ apiKey });
    const response = await anthropic.messages.create({
      model: CLAUDE_MODEL, max_tokens: 1500, system: systemInstruction, messages: [{ role: 'user', content: prompt }],
    });
    const raw = (response.content.find((b: any) => b.type === 'text') as any)?.text || '{}';
    return parseTriage(raw, record.priority);
  }

  // Gemini (default, free)
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey === 'YOUR_GEMINI_API_KEY_HERE') {
    throw new AppError('Gemini API key is not configured. Add GEMINI_API_KEY to your .env file.', 500);
  }
  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({
    model: GEMINI_MODEL,
    systemInstruction: { role: 'system', parts: [{ text: systemInstruction }] } as any,
    generationConfig: { responseMimeType: 'application/json' } as any,
  });
  const result = await model.generateContent(prompt);
  return parseTriage(result.response.text(), record.priority);
}
