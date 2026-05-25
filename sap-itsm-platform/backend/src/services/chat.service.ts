import { GoogleGenerativeAI, SchemaType } from '@google/generative-ai';
import Anthropic from '@anthropic-ai/sdk';
import { createRecord, getRecord, listRecords, addComment } from './record.service';
import { AppError } from '../utils/AppError';
import { prisma } from '../config/database';
import { getKnowledge } from './knowledge.service';
import { logger } from '../config/logger';

export async function processChatMessage(
  tenantId: string,
  userId: string,
  message: string,
  history: any[] = []
) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey === 'YOUR_GEMINI_API_KEY_HERE') {
    throw new AppError('Gemini API Key is not configured. Please add it to your .env file.', 500);
  }
  
  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({
    model: 'gemini-flash-latest',
    tools: [
      {
        functionDeclarations: [
          {
            name: 'create_ticket',
            description: 'Create a new ITSM ticket (Incident, Problem, or Change Request).',
            parameters: {
              type: SchemaType.OBJECT,
              properties: {
                title: { type: SchemaType.STRING, description: 'Short summary of the issue' },
                description: { type: SchemaType.STRING, description: 'Detailed description' },
                recordType: { type: SchemaType.STRING, enum: ['INCIDENT', 'PROBLEM', 'CHANGE_REQUEST'], description: 'Type of ticket' } as any,
                priority: { type: SchemaType.STRING, enum: ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'], description: 'Urgency of the issue' } as any,
              },
              required: ['title', 'description', 'recordType', 'priority'],
            } as any,
          },
          {
            name: 'get_ticket_status',
            description: 'Retrieve the current status and details of a specific ticket by its ID or ticket number.',
            parameters: {
              type: SchemaType.OBJECT,
              properties: {
                ticketId: { type: SchemaType.STRING, description: 'The UUID or Record Number (e.g., INC-2024-001) of the ticket' },
              },
              required: ['ticketId'],
            } as any,
          },
          {
            name: 'list_my_tickets',
            description: 'List all tickets created by the current user.',
            parameters: {
              type: SchemaType.OBJECT,
              properties: {
                limit: { type: SchemaType.NUMBER, description: 'Maximum number of tickets to return (default 5)' },
              },
            } as any,
          },
          {
            name: 'add_comment',
            description: 'Add a comment to an existing ticket.',
            parameters: {
              type: SchemaType.OBJECT,
              properties: {
                ticketId: { type: SchemaType.STRING, description: 'The UUID of the ticket' },
                text: { type: SchemaType.STRING, description: 'The comment text' },
              },
              required: ['ticketId', 'text'],
            } as any,
          },
          {
            name: 'list_agents',
            description: 'List all available support agents and their specializations.',
            parameters: {
              type: SchemaType.OBJECT,
              properties: {
                level: { type: SchemaType.STRING, enum: ['L1', 'L2', 'L3', 'SPECIALIST'], description: 'Filter by agent level' } as any,
              },
            } as any,
          },
        ],
      },
    ],
  });

  const userRecord = await prisma.user.findUnique({
    where: { id: userId },
    select: { firstName: true, lastName: true }
  });
  const userName = userRecord ? `${userRecord.firstName} ${userRecord.lastName || ''}`.trim() : 'User';

  const knowledge = await getKnowledge(tenantId);
  const knowledgeContext = knowledge ? `
CURRENT SYSTEM KNOWLEDGE (Snapshot from ${new Date(knowledge.updatedAt).toLocaleString()}):
- Active SAP Modules: ${knowledge.sapModules.map((m: any) => `${m.name} (${m.code})`).join(', ')}
- Available Support Agents: ${knowledge.agents.map((a: any) => `${a.name} (${a.level}, ${a.status})`).join(', ')}
- Top Customers: ${knowledge.customers.join(', ')}
- CMDB Status: ${knowledge.activeCMDB.map((c: any) => `${c.ciType}: ${c._count}`).join(', ')}
- Recent Ticket Stats (30d): ${knowledge.recentStats.map((s: any) => `${s.recordType} ${s.status}: ${s._count}`).join(', ')}
` : '';

  const systemInstruction = `You are the SAP ITSM AI Assistant. Your goal is to help users manage their IT service tickets efficiently.

You are currently talking to: ${userName}.

Important Guidelines:
1. Greet the user warmly by their name ("${userName}") at the start of the conversation or when appropriate.
2. Be very friendly, empathetic, and conversational in your tone. 
3. Provide short, easily readable responses. Never use massive walls of text. Use bullet points, bold text, and proper spacing.
4. If the user describes a problem, error, or SAP issue, proactively offer 1 or 2 troubleshooting ideas, potential root causes, or relevant SAP Transaction Codes (T-codes) to help them solve it. Act as a helpful L1/L2 support expert.
5. You can create tickets, check status, list tickets, and add comments.
6. When a user describes a problem, identify if it should be an INCIDENT or CHANGE_REQUEST.
7. If you need more information to perform an action (like priority or description), ask the user clearly.

${knowledgeContext}

Current User ID: ${userId}
Current Tenant ID: ${tenantId}`;

  try {
    // Map history to Gemini format and ensure strictly alternating roles
    const rawHistory = history.map(h => {
      let textContent = '';
      if (typeof h.content === 'string') {
        textContent = h.content;
      } else if (Array.isArray(h.content) && h.content[0]?.text) {
        textContent = h.content[0].text;
      } else {
        textContent = JSON.stringify(h.content);
      }
      return {
        role: h.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: textContent || ' ' }], // prevent empty parts
      };
    }).filter(h => h.parts[0].text !== '');

    const geminiHistory = [];
    for (const msg of rawHistory) {
      if (geminiHistory.length === 0) {
        if (msg.role === 'user') geminiHistory.push(msg);
      } else {
        const lastMsg = geminiHistory[geminiHistory.length - 1];
        if (lastMsg.role === msg.role) {
          // Merge consecutive messages from the same role
          lastMsg.parts[0].text += '\n' + msg.parts[0].text;
        } else {
          geminiHistory.push(msg);
        }
      }
    }

    const chat = model.startChat({
      history: geminiHistory,
      systemInstruction: {
        parts: [{ text: systemInstruction }],
      } as any,
    });

    const result = await chat.sendMessage(message);
    const response = result.response;
    const call = response.functionCalls()?.[0];

    if (call) {
      let toolResult;
      try {
        switch (call.name) {
          case 'create_ticket':
            toolResult = await createRecord({
              ...(call.args as any),
              tenantId,
              createdById: userId,
            });
            break;
          case 'get_ticket_status':
            toolResult = await getRecord((call.args as any).ticketId, tenantId);
            break;
          case 'list_my_tickets':
            toolResult = await listRecords({
              tenantId,
              createdById: userId,
              page: 1,
              limit: (call.args as any).limit || 5,
            });
            break;
          case 'add_comment':
            toolResult = await addComment(
              (call.args as any).ticketId,
              tenantId,
              userId,
              (call.args as any).text,
              false
            );
            break;
          case 'list_agents':
            const agents = await prisma.agent.findMany({
              where: {
                user: { tenantId },
                ...(call.args as any).level && { level: (call.args as any).level },
              },
              include: {
                user: { select: { firstName: true, lastName: true } },
              },
            });
            toolResult = agents.map(a => ({
              name: `${a.user.firstName} ${a.user.lastName}`,
              level: a.level,
              specialization: a.specialization,
              status: a.status,
            }));
            break;
          default:
            toolResult = { error: 'Unknown tool' };
        }
      } catch (err: any) {
        toolResult = { error: err.message || 'Error executing tool' };
      }

      // Send tool result back
      const finalResult = await chat.sendMessage([
        {
          functionResponse: {
            name: call.name,
            response: Array.isArray(toolResult) ? { data: toolResult } : toolResult,
          },
        },
      ]);
      
      let text = '';
      try {
        text = finalResult.response.text();
      } catch (e) {
        // Fallback if text() fails (e.g., if it's another tool call or blocked)
        const candidate = finalResult.response.candidates?.[0];
        text = candidate?.content?.parts?.find(p => p.text)?.text || 'I have processed that for you. Is there anything else?';
      }

      return {
        message: text,
        history: [
          ...history,
          { role: 'user', content: message },
          { role: 'assistant', content: [{ type: 'text', text }] },
        ],
      };
    }

    let text = '';
    try {
      text = response.text();
    } catch (e) {
      const candidate = response.candidates?.[0];
      text = candidate?.content?.parts?.find(p => p.text)?.text || 'I encountered an issue generating a response. How else can I help?';
    }

    return {
      message: text,
      history: [
        ...history,
        { role: 'user', content: message },
        { role: 'assistant', content: [{ type: 'text', text }] },
      ],
    };
  } catch (error: any) {
    // FALLBACK: If Gemini hits quota (429), try Claude if API key exists
    const isQuotaError = error.status === 429 || error.message?.includes('429') || error.message?.includes('quota');
    const claudeKey = process.env.ANTHROPIC_API_KEY;

    if (isQuotaError && claudeKey && claudeKey !== 'YOUR_CLAUDE_API_KEY_HERE') {
      logger.warn('⚠️ Gemini quota exceeded. Falling back to Anthropic Claude...', { tenantId });
      try {
        return await processClaudeMessage(tenantId, userId, message, history);
      } catch (claudeError: any) {
        logger.error('❌ Claude fallback also failed:', claudeError);
      }
    }

    logger.error('Gemini API Error Details:', {
      message: error.message,
      status: error.status,
      stack: error.stack,
      details: error.errorDetails
    });
    throw new AppError(`AI Service Error: ${error.message || 'Unknown error'}`, 500);
  }
}

async function processClaudeMessage(
  tenantId: string,
  userId: string,
  message: string,
  history: any[] = []
) {
  const anthropic = new Anthropic({
    apiKey: process.env.ANTHROPIC_API_KEY,
  });

  const userRecord = await prisma.user.findUnique({
    where: { id: userId },
    select: { firstName: true, lastName: true }
  });
  const userName = userRecord ? `${userRecord.firstName} ${userRecord.lastName || ''}`.trim() : 'User';

  const knowledge = await getKnowledge(tenantId);
  const knowledgeContext = knowledge ? `
CURRENT SYSTEM KNOWLEDGE (Snapshot from ${new Date(knowledge.updatedAt).toLocaleString()}):
- Active SAP Modules: ${knowledge.sapModules.map((m: any) => `${m.name} (${m.code})`).join(', ')}
- Available Support Agents: ${knowledge.agents.map((a: any) => `${a.name} (${a.level}, ${a.status})`).join(', ')}
- Top Customers: ${knowledge.customers.join(', ')}
- Recent Ticket Stats: ${knowledge.recentStats.map((s: any) => `${s.recordType} ${s.status}: ${s._count}`).join(', ')}
` : '';

  const systemInstruction = `You are the SAP ITSM AI Assistant. Help users manage IT tickets.
Greet the user as "${userName}". Be friendly and concise.
Proactively offer SAP troubleshooting (T-codes, root causes).

${knowledgeContext}

User ID: ${userId} | Tenant ID: ${tenantId}`;

  // Map history to Claude format
  const claudeMessages: any[] = history.map(h => ({
    role: h.role === 'assistant' ? 'assistant' : 'user',
    content: typeof h.content === 'string' ? h.content : (h.content[0]?.text || JSON.stringify(h.content))
  }));

  claudeMessages.push({ role: 'user', content: message });

  const response = await anthropic.messages.create({
    model: 'claude-3-haiku-20240307',
    max_tokens: 1024,
    system: systemInstruction,
    messages: claudeMessages,
  });

  const text = (response.content[0] as any).text;

  return {
    message: text,
    history: [
      ...history,
      { role: 'user', content: message },
      { role: 'assistant', content: [{ type: 'text', text }] },
    ],
  };
}
