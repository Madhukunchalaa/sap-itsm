import Anthropic from '@anthropic-ai/sdk';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { listRecords, getRecord, createRecord, updateRecord, addComment } from './record.service';
import { findSimilarTickets } from './rag.service';
import { scoreAgents } from './assignment.service';
import { processIntentMessage, resolveTicketId } from './intent.service';
import { AppError } from '../utils/AppError';
import { prisma } from '../config/database';
import { getKnowledge } from './knowledge.service';
import { logger } from '../config/logger';

// ---------------------------------------------------------------------------
// SAP ITSM AI Assistant — chatbot + AI triage.
//
// Provider is selectable via AI_PROVIDER:
//   'gemini' (default) — free tier, uses GEMINI_API_KEY
//   'claude'           — best quality, uses ANTHROPIC_API_KEY (paid)
// The tools, prompts, and behavior are identical across providers; only the
// LLM call differs.
//
// Tool access is role-gated:
//   - read tools + create_ticket + add_comment: any authenticated user
//   - assign_ticket / update_ticket_status / set_priority / get_overall_report:
//     staff only (SUPER_ADMIN, COMPANY_ADMIN, AGENT, PROJECT_MANAGER)
// Every write goes through record.service, so audit log + notifications +
// SLA handling behave exactly as if done in the UI.
//
// If no LLM is reachable (missing key, quota), chat degrades to the keyless
// intent mode in intent.service.ts instead of failing.
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
  // ---- Write tools (role rules enforced in runTool, not here) --------------
  {
    name: 'create_ticket',
    description:
      'Create a new ITSM ticket on behalf of the current user. Before calling, make sure you have ' +
      'a clear title and description from the user; ask briefly if anything essential is missing.',
    parameters: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Short summary of the issue' },
        description: { type: 'string', description: 'Detailed description of the issue' },
        recordType: { type: 'string', enum: TYPE_ENUM, description: 'INCIDENT (something broken), REQUEST (service request), PROBLEM (recurring root cause), CHANGE (planned change)' },
        priority: { type: 'string', enum: PRIORITY_ENUM, description: 'P1=critical/system down, P2=high, P3=medium (default), P4=low' },
      },
      required: ['title', 'description', 'recordType', 'priority'],
    },
  },
  {
    name: 'add_comment',
    description: 'Add a public comment to a ticket as the current user.',
    parameters: {
      type: 'object',
      properties: {
        ticket: { type: 'string', description: 'Record number (e.g. INC-2026-000123) or UUID' },
        text: { type: 'string', description: 'The comment text' },
      },
      required: ['ticket', 'text'],
    },
  },
  {
    name: 'assign_ticket',
    description:
      'STAFF ONLY. Assign a ticket to a support agent. If agentName is omitted, the best-matching agent ' +
      'is chosen automatically based on module specialization, workload, and availability.',
    parameters: {
      type: 'object',
      properties: {
        ticket: { type: 'string', description: 'Record number or UUID' },
        agentName: { type: 'string', description: 'Optional: first or last name of a specific agent to assign' },
      },
      required: ['ticket'],
    },
  },
  {
    name: 'update_ticket_status',
    description: 'STAFF ONLY. Change the status of a ticket.',
    parameters: {
      type: 'object',
      properties: {
        ticket: { type: 'string', description: 'Record number or UUID' },
        status: { type: 'string', enum: STATUS_ENUM, description: 'New status' },
      },
      required: ['ticket', 'status'],
    },
  },
  {
    name: 'set_priority',
    description: 'STAFF ONLY. Change the priority of a ticket (P1=critical … P4=low).',
    parameters: {
      type: 'object',
      properties: {
        ticket: { type: 'string', description: 'Record number or UUID' },
        priority: { type: 'string', enum: PRIORITY_ENUM, description: 'New priority' },
      },
      required: ['ticket', 'priority'],
    },
  },
  {
    name: 'get_overall_report',
    description:
      'STAFF ONLY. Generate the overall service-desk report: ticket volumes, SLA compliance, agent ' +
      'performance, module hotspots, and trends vs the previous period. Use for "give me a report / ' +
      'summary / how is the helpdesk doing" questions. Summarize the result conversationally.',
    parameters: {
      type: 'object',
      properties: {
        period: { type: 'string', enum: ['week', 'month'], description: 'Reporting period (default week)' },
      },
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

const STAFF_ROLES = ['SUPER_ADMIN', 'COMPANY_ADMIN', 'AGENT', 'PROJECT_MANAGER'];

interface ToolCtx { tenantId: string; userId: string; isStaff: boolean }

async function runTool(name: string, input: any, ctx: ToolCtx) {
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
    // ---- Write tools — every change goes through record.service, so audit
    // ---- log, notifications, and SLA handling behave exactly like the UI.
    case 'create_ticket': {
      const rec: any = await createRecord({
        recordType: (TYPE_ENUM.includes(input.recordType) ? input.recordType : 'INCIDENT') as any,
        title: String(input.title || '').slice(0, 200),
        description: String(input.description || input.title || ''),
        priority: (PRIORITY_ENUM.includes(input.priority) ? input.priority : 'P3') as any,
        tenantId: ctx.tenantId,
        createdById: ctx.userId,
      });
      return { success: true, ticket: rec.recordNumber, title: rec.title, priority: rec.priority, status: rec.status };
    }
    case 'add_comment': {
      const id = await resolveTicketId(String(input.ticket || ''), ctx.tenantId);
      if (!id) return { error: `No ticket found matching "${input.ticket}".` };
      await addComment(id, ctx.tenantId, ctx.userId, String(input.text || ''), false);
      return { success: true, info: 'Comment added.' };
    }
    case 'assign_ticket': {
      if (!ctx.isStaff) return { error: 'Permission denied: only agents and admins can assign tickets.' };
      const id = await resolveTicketId(String(input.ticket || ''), ctx.tenantId);
      if (!id) return { error: `No ticket found matching "${input.ticket}".` };
      const rec = await prisma.iTSMRecord.findFirst({
        where: { id, tenantId: ctx.tenantId },
        select: { id: true, recordNumber: true, customerId: true, priority: true, sapModuleId: true, sapSubModuleId: true },
      });
      if (!rec) return { error: 'Ticket not found.' };

      let targetAgentId: string | null = null;
      let reason = '';
      const requestedName = input.agentName ? String(input.agentName).trim() : '';

      if (requestedName) {
        const found = await prisma.agent.findFirst({
          where: {
            user: {
              tenantId: ctx.tenantId,
              OR: [
                { firstName: { contains: requestedName, mode: 'insensitive' } },
                { lastName: { contains: requestedName, mode: 'insensitive' } },
              ],
            },
          },
          include: { user: { select: { firstName: true, lastName: true } } },
        });
        if (!found) return { error: `No agent named "${requestedName}" found.` };
        targetAgentId = found.id;
        reason = `Assigned to ${found.user.firstName} ${found.user.lastName || ''}`.trim() + ' as requested';
      } else if (rec.customerId) {
        const scores = await scoreAgents({
          tenantId: ctx.tenantId,
          customerId: rec.customerId,
          priority: rec.priority,
          sapModuleId: rec.sapModuleId,
          sapSubModuleId: rec.sapSubModuleId,
        });
        const best = scores.find((s) => s.status !== 'OFFLINE' && s.openTickets < s.maxConcurrent);
        if (best) {
          targetAgentId = best.agentId;
          reason = `Best match: ${best.agentName} (${best.level}, ${best.openTickets}/${best.maxConcurrent} open tickets, score ${best.totalScore})`;
        }
      }

      if (!targetAgentId) {
        return { error: 'No suitable agent found — the ticket may have no customer, or all agents are at capacity. You can name a specific agent instead.' };
      }
      const updated: any = await updateRecord(rec.id, ctx.tenantId, ctx.userId, { assignedAgentId: targetAgentId });
      return {
        success: true,
        ticket: rec.recordNumber,
        assignedAgent: updated.assignedAgent?.user
          ? `${updated.assignedAgent.user.firstName} ${updated.assignedAgent.user.lastName || ''}`.trim()
          : null,
        reason,
      };
    }
    case 'update_ticket_status': {
      if (!ctx.isStaff) return { error: 'Permission denied: only agents and admins can change ticket status.' };
      if (!STATUS_ENUM.includes(input.status)) return { error: `Invalid status "${input.status}".` };
      const id = await resolveTicketId(String(input.ticket || ''), ctx.tenantId);
      if (!id) return { error: `No ticket found matching "${input.ticket}".` };
      const updated: any = await updateRecord(id, ctx.tenantId, ctx.userId, { status: input.status });
      return { success: true, ticket: updated.recordNumber, status: updated.status };
    }
    case 'set_priority': {
      if (!ctx.isStaff) return { error: 'Permission denied: only agents and admins can change priority.' };
      if (!PRIORITY_ENUM.includes(input.priority)) return { error: `Invalid priority "${input.priority}".` };
      const id = await resolveTicketId(String(input.ticket || ''), ctx.tenantId);
      if (!id) return { error: `No ticket found matching "${input.ticket}".` };
      const updated: any = await updateRecord(id, ctx.tenantId, ctx.userId, { priority: input.priority });
      return { success: true, ticket: updated.recordNumber, priority: updated.priority };
    }
    case 'get_overall_report': {
      if (!ctx.isStaff) return { error: 'Permission denied: reports are available to agents and admins only.' };
      const { generateOverallReport } = await import('./report.service');
      return generateOverallReport(ctx.tenantId, input.period === 'month' ? 'month' : 'week');
    }
    default:
      return { error: `Unknown tool: ${name}` };
  }
}

// ---- Shared context (system prompt with live knowledge snapshot) ----------
async function buildSystemPrompt(tenantId: string, userName: string, isStaff: boolean) {
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
- Create tickets (create_ticket) and add public comments (add_comment) on the user's behalf — confirm the details first.
${isStaff
  ? `- The current user is STAFF: you may also assign tickets (assign_ticket — auto-picks the best agent unless a name is given), change status (update_ticket_status), change priority (set_priority), and generate the overall service-desk report (get_overall_report).`
  : `- The current user is an END USER: you must NOT assign tickets or change status/priority. If asked, politely explain that a support agent will handle it.`}
- Help with general SAP and ITSM "how do I…" questions: T-codes, root causes, troubleshooting steps.

RULES:
- Write actions change real data. Only perform one when the user clearly asked for it, and confirm anything ambiguous (e.g. which ticket, which priority) before calling the tool. Report exactly what the tool did, including the ticket number.
- Always use a tool to get live data — never guess ticket counts, statuses, or details. For "how many" questions, call list_tickets with the right filters and report the exact total.
- Keep answers short and readable: use bold, bullet points, and spacing. No walls of text.
- When the user describes an error or SAP issue, proactively offer 1-2 troubleshooting ideas or relevant T-codes.
- If you need a filter the user didn't give (e.g. which plant), ask a brief clarifying question.
${knowledgeContext}`;
}

// ===========================================================================
// CLAUDE chat loop
// ===========================================================================
async function runClaudeChat(systemPrompt: string, priorMessages: Anthropic.MessageParam[], ctx: ToolCtx) {
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

async function runGeminiChat(systemPrompt: string, history: any[], message: string, ctx: ToolCtx) {
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
  const userRecord = await prisma.user.findUnique({ where: { id: userId }, select: { firstName: true, lastName: true, role: true } });
  const userName = userRecord ? `${userRecord.firstName} ${userRecord.lastName || ''}`.trim() : 'there';
  const isStaff = STAFF_ROLES.includes(userRecord?.role || 'USER');

  // No key configured for the active provider → keyless intent mode
  const providerKey = AI_PROVIDER === 'claude' ? process.env.ANTHROPIC_API_KEY : process.env.GEMINI_API_KEY;
  if (!providerKey || providerKey.startsWith('YOUR_')) {
    logger.warn(`AI chat: no ${AI_PROVIDER} key configured — serving keyless intent mode`, { tenantId });
    return processIntentMessage(tenantId, userId, message, history);
  }

  const systemPrompt = await buildSystemPrompt(tenantId, userName, isStaff);
  const ctx: ToolCtx = { tenantId, userId, isStaff };

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
      finalText = await runClaudeChat(systemPrompt, priorMessages, ctx);
    } else {
      finalText = await runGeminiChat(systemPrompt, history, message, ctx);
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

    // Quota / rate-limit → degrade to keyless basic mode instead of failing
    const errMsg = String(error.message || '');
    if (error.status === 429 || errMsg.includes('429') || /quota|rate.?limit|overloaded|resource.?exhausted/i.test(errMsg)) {
      logger.warn('AI chat: LLM quota exhausted — serving keyless intent mode', { tenantId });
      return processIntentMessage(
        tenantId, userId, message, history,
        '_(AI model temporarily unavailable — basic assistant mode)_\n\n'
      );
    }

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
