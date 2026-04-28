import { GoogleGenerativeAI } from '@google/generative-ai';
import { prisma } from '../config/database';
import { logger } from '../config/logger';

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || '');

export async function findSimilarAndSuggest(recordId: string, tenantId: string) {
  try {
    const record = await prisma.iTSMRecord.findUnique({
      where: { id: recordId },
      include: { sapModule: true }
    });

    if (!record) return;

    // Find similar resolved/closed tickets in the same module
    const similarTickets = await prisma.iTSMRecord.findMany({
      where: {
        tenantId,
        sapModuleId: record.sapModuleId,
        status: { in: ['RESOLVED', 'CLOSED'] },
        id: { not: recordId },
      },
      take: 10,
      orderBy: { createdAt: 'desc' },
      include: {
        comments: {
          where: { internalFlag: false },
          orderBy: { createdAt: 'desc' },
          take: 5,
          include: { author: { select: { role: true } } }
        }
      }
    });

    if (similarTickets.length === 0) return;

    // Prepare context for Gemini
    const context = similarTickets.map(t => {
      const resolution = t.comments.find(c => ['AGENT', 'SUPER_ADMIN', 'PROJECT_MANAGER'].includes(c.author.role))?.text || 'No explicit resolution found.';
      return `Ticket #${t.recordNumber}: ${t.title}\nDescription: ${t.description}\nResolution: ${resolution}`;
    }).join('\n\n---\n\n');

    const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });

    const prompt = `
      You are an AI IT Support Assistant for an SAP ITSM platform.
      A user has just raised a new ticket:
      Title: ${record.title}
      Description: ${record.description}

      Below are some similar tickets that were resolved in the past:
      ${context}

      Task:
      1. Analyze the current ticket and the past resolutions.
      2. If one or more past tickets are highly relevant, suggest a clear, step-by-step solution to the user.
      3. If no past tickets are relevant, return "NO_MATCH".
      4. Format your response in JSON:
      {
        "hasMatch": true/false,
        "suggestion": "The suggested solution text...",
        "confidence": 0.0 to 1.0,
        "relatedRecordNumber": "REC-XXXX"
      }
    `;

    const result = await model.generateContent(prompt);
    const response = await result.response;
    const text = response.text();
    
    // Extract JSON from response (handling potential markdown formatting)
    const jsonStr = text.match(/\{[\s\S]*\}/)?.[0] || text;
    const insight = JSON.parse(jsonStr);

    if (insight.hasMatch && insight.confidence > 0.6) {
      // Update record metadata with the suggestion
      const currentMetadata = (record.metadata as Record<string, any>) || {};
      await prisma.iTSMRecord.update({
        where: { id: recordId },
        data: {
          metadata: {
            ...currentMetadata,
            ai_suggestion: insight.suggestion,
            ai_related_record: insight.relatedRecordNumber
          }
        }
      });
      logger.info(`[AI] Suggestion generated for ${record.recordNumber}`);
    }

  } catch (error) {
    logger.error(`[AI] Error in findSimilarAndSuggest: ${error}`);
  }
}
