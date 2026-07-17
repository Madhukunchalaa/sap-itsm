import { RecordType } from '@prisma/client';
import { prisma } from '../config/database';
import { createRecord, getRecord, listRecords } from './record.service';
import { findSimilarTicketsLexical, stripHtml } from './similarity.service';

// ---------------------------------------------------------------------------
// Intent service — keyless chat fallback.
//
// Pattern-matched basic commands so the assistant keeps working when no LLM
// is reachable (missing API key, quota exhausted). One-shot commands only —
// no multi-turn state. Uses the lexical similarity engine (also keyless).
// ---------------------------------------------------------------------------

const TICKET_REF = /\b(INC|REQ|PRB|CHG|TKT)-\d{4}-\d{3,6}\b/i;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Resolve a ticket reference (UUID or record number like INC-2025-000123) to its id
export async function resolveTicketId(ref: string, tenantId: string): Promise<string | null> {
  const trimmed = String(ref || '').trim();
  if (UUID_RE.test(trimmed)) return trimmed;
  const rec = await prisma.iTSMRecord.findFirst({
    where: { tenantId, recordNumber: { equals: trimmed, mode: 'insensitive' } },
    select: { id: true },
  });
  return rec?.id || null;
}

function ticketLine(r: any): string {
  const agent = r.assignedAgent
    ? `${r.assignedAgent.user?.firstName || ''} ${r.assignedAgent.user?.lastName || ''}`.trim()
    : 'Unassigned';
  return `• **${r.recordNumber}** — ${r.title}\n   Status: ${r.status} | Priority: ${r.priority} | Agent: ${agent}`;
}

function reply(message: string, userMessage: string, history: any[]) {
  return {
    message,
    history: [
      ...history,
      { role: 'user', content: userMessage },
      { role: 'assistant', content: [{ type: 'text', text: message }] },
    ],
  };
}

const HELP_TEXT = `I'm running in **basic assistant mode** (no AI model available right now), but I can still do these:

• **My tickets** — type \`my tickets\`
• **Ticket status** — type a ticket number, e.g. \`status of INC-2025-000123\`
• **Create a ticket** — type \`create ticket: <title> - <details>\`
• **Find similar tickets** — type \`similar: <describe the issue>\`

For anything else, please try again later or contact your administrator.`;

export async function processIntentMessage(
  tenantId: string,
  userId: string,
  message: string,
  history: any[] = [],
  notePrefix = ''
) {
  const msg = message.trim();
  const lower = msg.toLowerCase();

  try {
    // 1. Ticket status — any message containing a record number
    const ref = msg.match(TICKET_REF);
    if (ref && !lower.startsWith('create')) {
      const id = await resolveTicketId(ref[0], tenantId);
      if (!id) return reply(`${notePrefix}I couldn't find ticket **${ref[0]}**. Please check the number.`, message, history);
      const r: any = await getRecord(id, tenantId);
      const lastComment = r.comments?.filter((c: any) => !c.internalFlag).slice(-1)[0];
      let text = `${notePrefix}Here's the latest on **${r.recordNumber}**:\n\n${ticketLine(r)}`;
      if (r.slaTracking?.resolutionDeadline) {
        text += `\n   SLA resolution due: ${new Date(r.slaTracking.resolutionDeadline).toLocaleString()}`;
      }
      if (lastComment) {
        text += `\n   Last update: ${stripHtml(lastComment.text).slice(0, 200)}`;
      }
      return reply(text, message, history);
    }

    // 2. List my tickets
    if (/\b(my|list|show|open)\b.*\b(tickets?|incidents?|requests?)\b/.test(lower) || lower === 'tickets') {
      const result = await listRecords({ tenantId, createdById: userId, page: 1, limit: 5 } as any);
      const items = (result as any).data || [];
      if (items.length === 0) return reply(`${notePrefix}You have no tickets yet. Type \`create ticket: <title> - <details>\` to open one.`, message, history);
      const text = `${notePrefix}Your most recent tickets:\n\n${items.map(ticketLine).join('\n')}`;
      return reply(text, message, history);
    }

    // 3. Create ticket — one-shot: "create ticket: <title> - <details>"
    const create = msg.match(/^create\s+(?:a\s+)?(?:new\s+)?(ticket|incident|request|problem|change)\s*[:\-]?\s*([\s\S]*)$/i);
    if (create) {
      const body = create[2].trim();
      if (!body) {
        return reply(`${notePrefix}To create a ticket, use this format:\n\n\`create ticket: <short title> - <detailed description>\``, message, history);
      }
      const [titlePart, ...rest] = body.split(/\s+-\s+/);
      const title = titlePart.slice(0, 120);
      const description = rest.join(' - ').trim() || body;
      const typeWord = create[1].toUpperCase();
      const recordType: RecordType =
        typeWord === 'REQUEST' ? 'REQUEST'
        : typeWord === 'PROBLEM' ? 'PROBLEM'
        : typeWord === 'CHANGE' ? 'CHANGE'
        : 'INCIDENT';

      const record: any = await createRecord({
        recordType,
        title,
        description,
        priority: 'P3',
        tenantId,
        createdById: userId,
      });
      return reply(
        `${notePrefix}✅ Ticket created: **${record.recordNumber}** — ${record.title}\nPriority: ${record.priority} (default). An agent will pick this up shortly.`,
        message, history
      );
    }

    // 4. Similar tickets — "similar: <text>"
    const similar = msg.match(/^(?:find\s+)?similar\s*[:\-]?\s*([\s\S]+)$/i);
    if (similar) {
      const results = await findSimilarTicketsLexical(tenantId, similar[1], { topK: 3 });
      if (results.length === 0) return reply(`${notePrefix}No similar resolved tickets found.`, message, history);
      const text = `${notePrefix}Similar resolved tickets:\n\n${results
        .map(s => `• **${s.recordNumber}** — ${s.title} (${Math.round(s.score * 100)}% match)${s.resolutionHint ? `\n   ↳ ${s.resolutionHint.replace(/\s+/g, ' ').slice(0, 150)}` : ''}`)
        .join('\n')}`;
      return reply(text, message, history);
    }

    // 5. Fallback — help
    return reply(`${notePrefix}${HELP_TEXT}`, message, history);
  } catch (err: any) {
    return reply(`${notePrefix}Sorry, that action failed: ${err.message || 'unknown error'}`, message, history);
  }
}
