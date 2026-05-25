import { Router, Request, Response, NextFunction } from 'express';
import { verifyJWT, enforceTenantScope } from '../middleware/auth.middleware';
import { processChatMessage } from '../../services/chat.service';
import { generateKnowledge } from '../../services/knowledge.service';

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

router.post('/train', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const knowledge = await generateKnowledge(req.user!.tenantId);
    res.json({ success: true, message: 'AI model successfully trained with current database state.', data: knowledge });
  } catch (err) {
    next(err);
  }
});

export default router;
