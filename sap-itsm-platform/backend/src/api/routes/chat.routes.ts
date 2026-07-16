import { Router, Request, Response, NextFunction } from 'express';
import { verifyJWT, enforceTenantScope } from '../middleware/auth.middleware';
import { processChatMessage } from '../../services/chat.service';
import { generateKnowledge } from '../../services/knowledge.service';
import { indexResolvedTickets } from '../../services/rag.service';

const router = Router();

router.use(verifyJWT, enforceTenantScope);

router.post('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { message, history } = req.body;
    
    if (!message) {
      return res.status(400).json({ success: false, error: 'Message is required' });
    }

    const result = await processChatMessage(
      req.user!.tenantId,
      req.user!.sub,
      message,
      history || []
    );

    res.json({ success: true, ...result });
  } catch (err) {
    next(err);
  }
});

// "Train" = refresh the knowledge snapshot + rebuild the RAG embedding index
// over resolved tickets. Consumes embedding-API quota, so Super Admin only.
router.post('/train', async (req: Request, res: Response, next: NextFunction) => {
  try {
    if (req.user!.role !== 'SUPER_ADMIN') {
      return res.status(403).json({ success: false, error: 'Only Super Admin can retrain the AI.' });
    }
    const knowledge = await generateKnowledge(req.user!.tenantId);
    const rag = await indexResolvedTickets(req.user!.tenantId);
    res.json({
      success: true,
      message: `AI refreshed. RAG index: ${rag.indexed} tickets indexed, ${rag.skipped} unchanged, ${rag.failed} failed.`,
      data: { knowledge, rag },
    });
  } catch (err) {
    next(err);
  }
});

export default router;
