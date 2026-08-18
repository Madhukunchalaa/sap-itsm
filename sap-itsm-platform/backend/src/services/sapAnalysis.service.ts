import { GoogleGenAI } from '@google/genai';
import Anthropic from '@anthropic-ai/sdk';
import { prisma } from '../config/database';
import { cache } from '../config/redis';
import { logger } from '../config/logger';
import { AppError } from '../utils/AppError';
import { getRecord } from './record.service';
import { listSapTools, callSapTool, isReadOnlySapTool } from './sapMcpClient.service';

// ---------------------------------------------------------------------------
// SAP ticket automation pipeline — human-gated, on demand only:
//   1. Business user creates a ticket as normal (no AI involved at creation).
//   2. Staff clicks "Perform AI Analysis" on the ticket (record.routes.ts,
//      gated to User.canRunSapAnalysis — see canRunSapAnalysis() in record.routes.ts).
//   3. buildTicketPrompt() turns the ticket into a precise analysis prompt,
//      with module-specific guidance from MODULE_HINTS.
//   4. The prompt + live SAP MCP tools are handed to the LLM in a
//      tool-calling loop (runGeminiToolLoop / runClaudeToolLoop) — read-only
//      SAP tools only (sapMcpClient.service.ts enforces this).
//   5. The result is returned to the frontend into an editable textarea for
//      human review/editing — nothing is written back automatically.
//   6. When the user is satisfied, saveSapAnalysis() posts the (possibly
//      edited) text as an internal comment. Never auto-closes the ticket.
// ---------------------------------------------------------------------------

const AI_PROVIDER = (process.env.AI_PROVIDER || 'gemini').toLowerCase();
const CLAUDE_MODEL = 'claude-sonnet-5';
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
const MAX_TOOL_ROUNDS = 8;

function stripHtml(html: string): string {
  return (html || '').replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
}

// Lightweight "module-wise agent" — same pipeline, but the prompt is steered
// with guidance specific to the ticket's SAP module.
const MODULE_HINTS: Record<string, string> = {
  MM: 'Focus on Materials Management: purchase orders/requisitions, vendor & material master data, goods receipt/GR-IR, inventory movements.',
  FI: 'Focus on Financial Accounting: GL postings, vendor/customer invoices, payment blocks, bank reconciliation.',
  FICO: 'Focus on Financial Accounting / Controlling: GL postings, cost centers, vendor/customer invoices, payment blocks.',
  CO: 'Focus on Controlling: cost center accounting, product costing, profitability analysis, internal orders.',
  SD: 'Focus on Sales & Distribution: sales orders, deliveries, billing, pricing, customer master.',
  PP: 'Focus on Production Planning: MRP, bill of materials, routing, shop floor control.',
  PM: 'Focus on Plant Maintenance: work orders, equipment records, maintenance notifications, calibration.',
  QM: 'Focus on Quality Management: quality inspections, notifications, certificates.',
  HR: 'Focus on Human Resources (HCM): personnel administration, payroll, time management.',
  WM: 'Focus on Warehouse Management: storage, goods receipt/issue, physical inventory.',
  BASIS: 'Focus on SAP Basis/technical: authorizations & roles, performance, transports, RFC/IDoc connectivity.',
  ABAP: 'Focus on ABAP development: custom reports, enhancements/BADIs, forms, workflow, interfaces.',
};

export interface ClarificationAnswer {
  question: string;
  answer: string;
}

function buildTicketPrompt(record: any, clarifications?: ClarificationAnswer[]): string {
  const moduleCode = record.sapModule?.code || '';
  const moduleHint = MODULE_HINTS[moduleCode] || 'No module-specific guidance available — use general SAP knowledge for this ticket.';

  const clarificationBlock = clarifications?.length
    ? `\nCLARIFICATIONS ALREADY PROVIDED BY THE USER (use these, do not ask again):\n${clarifications.map(c => `- Q: ${c.question}\n  A: ${c.answer}`).join('\n')}\n`
    : '';

  return `You are analyzing an SAP ITSM ticket against a live SAP S/4HANA system using the connected MCP tools.

TICKET
- Number: ${record.recordNumber}
- Type: ${record.recordType} | Priority: ${record.priority} | Status: ${record.status}
- Plant: ${record.plant || 'N/A'}
- SAP Module: ${record.sapModule?.name || 'N/A'} (${moduleCode || 'N/A'})${record.sapSubModule?.name ? ' / ' + record.sapSubModule.name : ''}
- Title: ${record.title}
- Description: ${stripHtml(record.description) || '(none)'}
${clarificationBlock}
MODULE-SPECIFIC GUIDANCE: ${moduleHint}

TASK
1. First, decide whether you have enough information to give a CORRECT,
   non-generic answer. Many tickets are worded loosely (e.g. "notify PO
   creator on approval") and the right SAP configuration depends entirely on
   specifics the ticket doesn't state — e.g. whether the release/approval
   workflow is Classic Release Strategy or Flexible Workflow, which document
   type/company code is involved, which output channel (email vs print) is
   wanted. Guessing here produces a generic, often-wrong checklist.
2. If a decision-critical detail is missing AND wasn't already provided in
   "CLARIFICATIONS ALREADY PROVIDED" above, do NOT guess and do NOT produce a
   root cause yet. Instead set "needsClarification": true and ask up to 3
   short, specific questions whose answers change what you'd recommend
   (e.g. "Is the PO release strategy Classic or Flexible Workflow?"). Prefer
   questions a business user can answer without SAP expertise; offer likely
   options in the question text where helpful.
3. Otherwise (you have enough information, from the ticket and/or the
   clarifications above): use the SAP tools to look up whatever live SAP data
   is relevant, determine the most likely root cause grounded in what you
   actually found, and propose a concrete resolution an SAP L2 engineer could
   follow. If no SAP service covers this ticket's need, say so explicitly —
   never fabricate SAP data or a root cause you couldn't actually verify.

Respond with ONLY a JSON object (no prose, no markdown fences).
If you need clarification (step 2), use exactly:
{
  "needsClarification": true,
  "clarifyingQuestions": ["question 1", "question 2"]
}
Otherwise (step 3), use exactly:
{
  "needsClarification": false,
  "sapDataFound": true or false,
  "rootCause": "1-3 sentences, grounded in what you actually found in SAP",
  "suggestedSolution": "concrete resolution steps, as short markdown",
  "sapTcodes": ["relevant SAP transaction codes if applicable"],
  "sapServicesQueried": ["names of OData services/tools actually called"],
  "confidence": "low | medium | high"
}`;
}

export interface SapAnalysisResult {
  needsClarification: boolean;
  clarifyingQuestions: string[];
  sapDataFound: boolean;
  rootCause: string;
  suggestedSolution: string;
  sapTcodes: string[];
  sapServicesQueried: string[];
  confidence: string;
}

function parseResult(raw: string): SapAnalysisResult {
  const cleaned = raw.replace(/```json|```/g, '').trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  try {
    const p = JSON.parse(start >= 0 ? cleaned.slice(start, end + 1) : cleaned);
    return {
      needsClarification: !!p.needsClarification,
      clarifyingQuestions: Array.isArray(p.clarifyingQuestions) ? p.clarifyingQuestions : [],
      sapDataFound: !!p.sapDataFound,
      rootCause: p.rootCause || '',
      suggestedSolution: p.suggestedSolution || '',
      sapTcodes: Array.isArray(p.sapTcodes) ? p.sapTcodes : [],
      sapServicesQueried: Array.isArray(p.sapServicesQueried) ? p.sapServicesQueried : [],
      confidence: p.confidence || 'low',
    };
  } catch {
    return {
      needsClarification: false, clarifyingQuestions: [],
      sapDataFound: false, rootCause: '', suggestedSolution: raw,
      sapTcodes: [], sapServicesQueried: [], confidence: 'low',
    };
  }
}

// Gemini/Claude's function-calling schema is a stricter subset of JSON
// Schema — strip fields they don't accept (e.g. `additionalProperties`,
// which sap_get_entity's keyValues param uses) and drop write tools so the
// model is never even offered sap_create_entity/sap_update_entity.
function sanitizeSchema(schema: any): any {
  if (!schema || typeof schema !== 'object') return schema;
  const { additionalProperties, $schema, ...rest } = schema;
  if (rest.properties && typeof rest.properties === 'object') {
    rest.properties = Object.fromEntries(
      Object.entries(rest.properties).map(([k, v]) => [k, sanitizeSchema(v)])
    );
  }
  if (rest.items) rest.items = sanitizeSchema(rest.items);
  return rest;
}

function toolsForLLM(tools: any[]): any[] {
  return tools
    .filter((t) => isReadOnlySapTool(t.name))
    .map((t) => ({ ...t, inputSchema: sanitizeSchema(t.inputSchema) }));
}

const SYSTEM_INSTRUCTION =
  'You are a senior SAP ITSM analyst investigating a ticket using the connected ' +
  'SAP tools. Output only valid JSON matching the requested schema once you are done.';

// Manual prompt-based tool loop (ask the model to decide, execute, feed the
// result back into the next prompt) instead of native function-calling —
// this is the exact pattern already validated end-to-end in
// lnmission/server.js against this SAP system, and sidesteps @google/genai's
// stricter/changing native function-call role handling.
async function runGeminiToolLoop(prompt: string, tools: any[]): Promise<string> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey.startsWith('YOUR_')) {
    throw new AppError('Gemini API key is not configured for SAP analysis.', 500);
  }
  const ai = new GoogleGenAI({ apiKey });
  const toolsList = tools.map((t) => ({ name: t.name, description: t.description, parameters: t.inputSchema }));

  let conversation = prompt;

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const decisionPrompt = `${SYSTEM_INSTRUCTION}

${conversation}

SAP TOOLS AVAILABLE:
${JSON.stringify(toolsList, null, 2)}

If you need more SAP data, respond ONLY with a JSON object in this exact format:
{ "tool_name": "name of the tool", "arguments": { ...arguments } }
If you already have enough information, respond ONLY with the final analysis JSON object described earlier (the one with rootCause/suggestedSolution/etc keys) — no markdown fences, no prose.`;

    const response = await ai.models.generateContent({ model: GEMINI_MODEL, contents: decisionPrompt });
    const text = (response.text || '').replace(/```json/g, '').replace(/```/g, '').trim();

    let decision: any;
    try { decision = JSON.parse(text); } catch { return text; }

    if (!decision.tool_name) return text;

    let toolResult: any;
    try { toolResult = await callSapTool(decision.tool_name, decision.arguments); }
    catch (err: any) { toolResult = { error: err.message || 'SAP tool call failed' }; }
    const content = toolResult?.content?.[0]?.text ?? JSON.stringify(toolResult);

    conversation += `\n\nYou called tool "${decision.tool_name}" with arguments ${JSON.stringify(decision.arguments)}.\nResult:\n${content}`;
  }

  // Round limit reached without a final answer — force one, using whatever
  // was gathered so far, rather than returning an empty/low-confidence blank.
  logger.warn('[SapAnalysis] Gemini tool loop hit MAX_TOOL_ROUNDS without concluding — forcing final answer');
  const finalPrompt = `${SYSTEM_INSTRUCTION}

${conversation}

You have reached the tool-call limit for this investigation. Do NOT call any more tools.
Respond ONLY with the final analysis JSON object now, using whatever you have found so far
(set "confidence" to "low" if the picture is incomplete, and say so in "rootCause" rather than
leaving it blank) — no markdown fences, no prose.`;
  const finalResponse = await ai.models.generateContent({ model: GEMINI_MODEL, contents: finalPrompt });
  return (finalResponse.text || '').replace(/```json/g, '').replace(/```/g, '').trim();
}

async function runClaudeToolLoop(prompt: string, tools: any[]): Promise<string> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey || apiKey.startsWith('YOUR_')) {
    throw new AppError('Anthropic API key is not configured for SAP analysis.', 500);
  }
  const anthropic = new Anthropic({ apiKey });
  const claudeTools = tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.inputSchema }));
  const messages: any[] = [{ role: 'user', content: prompt }];

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const response = await anthropic.messages.create({
      model: CLAUDE_MODEL, max_tokens: 1500, system: SYSTEM_INSTRUCTION,
      tools: claudeTools as any, messages,
    });
    if (response.stop_reason === 'tool_use') {
      messages.push({ role: 'assistant', content: response.content });
      const toolResults: any[] = [];
      for (const block of response.content) {
        if (block.type === 'tool_use') {
          let result: any;
          try { result = await callSapTool(block.name, block.input); }
          catch (err: any) { result = { error: err.message || 'SAP tool call failed' }; }
          const content = result?.content?.[0]?.text ?? JSON.stringify(result);
          toolResults.push({ type: 'tool_result', tool_use_id: block.id, content });
        }
      }
      messages.push({ role: 'user', content: toolResults });
      continue;
    }
    return response.content.filter((b: any) => b.type === 'text').map((b: any) => b.text).join('\n').trim();
  }

  // Round limit reached without a final answer — force one (no tools offered
  // this time), using whatever was gathered so far.
  logger.warn('[SapAnalysis] Claude tool loop hit MAX_TOOL_ROUNDS without concluding — forcing final answer');
  messages.push({
    role: 'user',
    content: 'You have reached the tool-call limit for this investigation. Do NOT call any more tools. ' +
      'Respond ONLY with the final analysis JSON object now, using whatever you have found so far ' +
      '(set "confidence" to "low" if the picture is incomplete, and say so in "rootCause" rather than ' +
      'leaving it blank) — no markdown fences, no prose.',
  });
  const finalResponse = await anthropic.messages.create({
    model: CLAUDE_MODEL, max_tokens: 1500, system: SYSTEM_INSTRUCTION, messages,
  });
  return finalResponse.content.filter((b: any) => b.type === 'text').map((b: any) => b.text).join('\n').trim();
}

export async function analyzeTicketWithSap(
  tenantId: string, recordId: string, clarifications?: ClarificationAnswer[]
): Promise<SapAnalysisResult> {
  const record: any = await getRecord(recordId, tenantId);
  if (!record) throw new AppError('Ticket not found.', 404);

  const tools = toolsForLLM(await listSapTools());
  const prompt = buildTicketPrompt(record, clarifications);

  const raw = AI_PROVIDER === 'claude'
    ? await runClaudeToolLoop(prompt, tools)
    : await runGeminiToolLoop(prompt, tools);

  return parseResult(raw || '{}');
}

// Plain-text rendering used to prefill the review textarea on the frontend —
// only meaningful once needsClarification is false (a final analysis).
export function formatAnalysisForReview(a: SapAnalysisResult): string {
  const lines: string[] = [];
  lines.push(`SAP data found: ${a.sapDataFound ? 'Yes' : 'No'}`);
  if (a.sapServicesQueried.length) lines.push(`SAP services queried: ${a.sapServicesQueried.join(', ')}`);
  lines.push('');
  lines.push(`Root cause: ${a.rootCause || '(not determined)'}`);
  lines.push('');
  if (a.suggestedSolution) { lines.push('Suggested resolution:'); lines.push(a.suggestedSolution); lines.push(''); }
  if (a.sapTcodes.length) lines.push(`Relevant T-codes: ${a.sapTcodes.join(', ')}`);
  lines.push(`Confidence: ${a.confidence}`);
  return lines.join('\n').trim();
}

// Posts the (possibly human-edited) analysis text as an internal comment.
// Called only when the user explicitly clicks "Save Analysis" — nothing
// happens automatically.
export async function saveSapAnalysis(
  tenantId: string, recordId: string, userId: string, text: string
): Promise<void> {
  const record = await prisma.iTSMRecord.findFirst({ where: { id: recordId, tenantId }, select: { metadata: true } });
  if (!record) throw new AppError('Ticket not found.', 404);

  const existingMeta = (record.metadata as Record<string, unknown>) || {};
  await prisma.iTSMRecord.update({
    where: { id: recordId },
    data: { metadata: { ...existingMeta, sapAnalysis: { text, savedAt: new Date().toISOString(), savedBy: userId } } as any },
  });

  await prisma.comment.create({
    data: {
      recordId,
      authorId: userId,
      text: `🔎 SAP Analysis (reviewed by human before closing)\n\n${text}`,
      internalFlag: true,
    },
  });

  await cache.del(cache.key.record(recordId));
  logger.info(`[SapAnalysis] Saved for ${recordId} by ${userId}`);
}
