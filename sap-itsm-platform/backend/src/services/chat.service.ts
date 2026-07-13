import Anthropic from '@anthropic-ai/sdk';
import { listRecords, getRecord } from './record.service';
import { AppError } from '../utils/AppError';
import { prisma } from '../config/database';
import { getKnowledge } from './knowledge.service';
import { logger } from '../config/logger';

// ---------------------------------------------------------------------------
// SAP ITSM AI Assistant — Claude-powered, READ-ONLY chatbot.
//
// The bot answers questions over live ticket data (via tools) and helps with
// SAP/ITSM "how do I…" questions (via the model + knowledge snapshot). It never
// creates, edits, comments on, or assigns tickets — every tool is a pure read.
// ---------------------------------------------------------------------------

// Default model. For a high-volume chat you can drop to 'claude-haiku-4-5'
// (cheapest/fastest) or 'claude-sonnet-5' (mid) — same tool-use API.
const MODEL = 'claude-opus-4-8';
const MAX_TOOL_ROUNDS = 4;

const STATUS_ENUM = [
  'NEW', 'OPEN', 'IN_PROGRESS', 'PENDING', 'AWAITING_CUSTOMER',
  'WITH_SAP', 'REOPEN', 'RESOLVED', 'CLOSED', 'CANCELLED',
];
const PRIORITY_ENUM = ['P1', 'P2', 'P3', 'P4'];
const TYPE_ENUM = ['INCIDENT', 'REQUEST', 'PROBLEM', 'CHANGE'];

// ---- Read-only tool definitions -------------------------------------------
const TOOLS: Anthropic.Tool[] = [
  {
    name: 'list_tickets',
    description:
      'Search and list ITSM tickets with optional filters. Returns the total ' +
      'match count plus a page of summaries. Use this to answer "how many…", ' +
      '"show me…", or "list…" questions. All filters are optional and combine ' +
      'with AND.',
    input_schema: {
      type: 'object',
      properties: {
        status: { type: 'array', items: { type: 'string', enum: STATUS_ENUM }, description: 'Filter by one or more statuses' },
        priority: { type: 'array', items: { type: 'string', enum: PRIORITY_ENUM }, description: 'Filter by one or more priorities' },
        recordType: { type: 'array', items: { type: 'string', enum: TYPE_ENUM }, description: 'Filter by one or more record types' },
        plant: { type: 'string', description: 'Exact plant name, e.g. "2121 - Anpara"' },
        search: { type: 'string', description: 'Free-text search over title, description, record number, and SAP module' },
        mine: { type: 'boolean', description: 'If true, only tickets created by the current user' },
        limit: { type: 'number', description: 'Max summaries to return (1-25, default 10). The total count is always exact regardless of this.' },
      },
    },
  },
  {
    name: 'get_ticket',
    description:
      'Get the full detail of a single ticket by its record number ' +
      '(e.g. "INC-2024-0001") or UUID, including comments.',
    input_schema: {
      type: 'object',
      properties: {
        ticket: { type: 'string', description: 'Record number or UUID of the ticket' },
      },
      required: ['ticket'],
    },
  },
  {
    name: 'list_agents',
    description: 'List support agents with their level, specialization, and availability status.',
    input_schema: {
      type: 'object',
      properties: {
        level: { type: 'string', enum: ['L1', 'L2', 'L3', 'SPECIALIST'], description: 'Optional: filter by agent level' },
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

async function runTool(name: string, input: any, ctx: { tenantId: string; userId: string }) {
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
      return {
        total: res.pagination.total,
        showing: res.data.length,
        tickets: (res.data as any[]).map(summarizeTicket),
      };
    }

    case 'get_ticket': {
      let id: string = String(input.ticket || '').trim();
      const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
      if (!isUuid) {
        // Resolve a record number (or partial) to a UUID first.
        const found = await listRecords({ tenantId: ctx.tenantId, page: 1, limit: 1, search: id } as any);
        if (!found.data.length) return { error: `No ticket found matching "${input.ticket}".` };
        id = (found.data[0] as any).id;
      }
      const rec = await getRecord(id, ctx.tenantId);
      return rec || { error: 'Ticket not found.' };
    }

    case 'list_agents': {
      const agents = await prisma.agent.findMany({
        where: {
          user: { tenantId: ctx.tenantId },
          ...(input.level && { level: input.level }),
        },
        include: { user: { select: { firstName: true, lastName: true } } },
      });
      return agents.map((a) => ({
        name: `${a.user.firstName} ${a.user.lastName || ''}`.trim(),
        level: a.level,
        specialization: a.specialization,
        status: a.status,
      }));
    }

    default:
      return { error: `Unknown tool: ${name}` };
  }
}

// ---- Main entry point ------------------------------------------------------
export async function processChatMessage(
  tenantId: string,
  userId: string,
  message: string,
  history: any[] = []
) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey || apiKey === 'YOUR_CLAUDE_API_KEY_HERE') {
    throw new AppError('Anthropic API key is not configured. Add ANTHROPIC_API_KEY to your .env file.', 500);
  }

  const anthropic = new Anthropic({ apiKey });

  const userRecord = await prisma.user.findUnique({
    where: { id: userId },
    select: { firstName: true, lastName: true },
  });
  const userName = userRecord
    ? `${userRecord.firstName} ${userRecord.lastName || ''}`.trim()
    : 'there';

  const knowledge = await getKnowledge(tenantId);
  const knowledgeContext = knowledge
    ? `
CURRENT SYSTEM SNAPSHOT (as of ${new Date(knowledge.updatedAt).toLocaleString()}):
- Active SAP Modules: ${knowledge.sapModules.map((m: any) => `${m.name} (${m.code})`).join(', ')}
- Support Agents: ${knowledge.agents.map((a: any) => `${a.name} (${a.level}, ${a.status})`).join(', ')}
- Top Customers: ${knowledge.customers.join(', ')}
- Recent Ticket Stats: ${knowledge.recentStats.map((s: any) => `${s.recordType} ${s.status}: ${s._count}`).join(', ')}`
    : '';

  const systemPrompt = `You are the SAP ITSM AI Assistant, a friendly and knowledgeable L1/L2 support expert.
You are talking to ${userName}.

WHAT YOU CAN DO:
- Answer questions about tickets by calling the read-only tools (list_tickets, get_ticket, list_agents).
- Help with SAP and ITSM "how do I…" questions: suggest relevant SAP T-codes, likely root causes, and troubleshooting steps.

RULES:
- You are READ-ONLY. You cannot create, edit, comment on, assign, or close tickets. If the user asks you to change something, explain that you can only look things up, and tell them where in the app to do it themselves.
- Always use a tool to get live data — never guess ticket counts, statuses, or details. For "how many" questions, call list_tickets with the right filters and report the exact total.
- Keep answers short and readable: use bold, bullet points, and spacing. No walls of text.
- When the user describes an error or SAP issue, proactively offer 1-2 troubleshooting ideas or relevant T-codes.
- If you need a filter the user didn't give (e.g. which plant), ask a brief clarifying question.
${knowledgeContext}`;

  // Rebuild the running message array from prior turns (stored as text-only).
  const messages: Anthropic.MessageParam[] = history
    .map((h) => {
      const text =
        typeof h.content === 'string'
          ? h.content
          : Array.isArray(h.content)
          ? h.content.map((c: any) => c.text || '').join('')
          : String(h.content ?? '');
      return { role: h.role === 'assistant' ? 'assistant' : 'user', content: text } as Anthropic.MessageParam;
    })
    .filter((m) => typeof m.content === 'string' && m.content.trim() !== '');

  messages.push({ role: 'user', content: message });

  try {
    let finalText = '';

    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      const response = await anthropic.messages.create({
        model: MODEL,
        max_tokens: 1500,
        system: systemPrompt,
        tools: TOOLS,
        messages,
      });

      if (response.stop_reason === 'tool_use') {
        // Append the assistant turn (must include the tool_use blocks), then
        // execute every requested tool and return all results in one user turn.
        messages.push({ role: 'assistant', content: response.content });

        const toolResults: Anthropic.ToolResultBlockParam[] = [];
        for (const block of response.content) {
          if (block.type === 'tool_use') {
            let result: any;
            try {
              result = await runTool(block.name, block.input, { tenantId, userId });
            } catch (err: any) {
              result = { error: err.message || 'Tool execution failed' };
            }
            toolResults.push({
              type: 'tool_result',
              tool_use_id: block.id,
              content: JSON.stringify(result),
            });
          }
        }
        messages.push({ role: 'user', content: toolResults });
        continue; // let Claude read the results and respond
      }

      // No tool use — this is the final answer.
      finalText = response.content
        .filter((b) => b.type === 'text')
        .map((b: any) => b.text)
        .join('\n')
        .trim();
      break;
    }

    if (!finalText) {
      finalText = "I looked into that but couldn't put together a clear answer — could you rephrase?";
    }

    return {
      message: finalText,
      history: [
        ...history,
        { role: 'user', content: message },
        { role: 'assistant', content: [{ type: 'text', text: finalText }] },
      ],
    };
  } catch (error: any) {
    logger.error('Claude chat error:', {
      message: error.message,
      status: error.status,
      requestId: error.request_id,
    });
    throw new AppError(`AI Service Error: ${error.message || 'Unknown error'}`, 500);
  }
}
