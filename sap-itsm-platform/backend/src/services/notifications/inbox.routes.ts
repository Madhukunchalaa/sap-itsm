import { Router, Request, Response, NextFunction } from 'express';
import { PrismaClient } from '@prisma/client';
import { verifyJWT, enforceTenantScope } from '../../api/middleware/auth.middleware';

const prisma = new PrismaClient();
const router = Router();
router.use(verifyJWT, enforceTenantScope);

// GET /notifications/inbox — list user's notifications
router.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = req.user!.sub;
    const page = Number(req.query.page) || 1;
    const limit = Number(req.query.limit) || 20;
    const skip = (page - 1) * limit;
    const unreadOnly = req.query.unread === 'true';

    const where: any = { userId, tenantId: req.user!.tenantId };
    if (unreadOnly) where.isRead = false;

    const [notifications, total, unreadCount] = await Promise.all([
      prisma.notification.findMany({
        where, skip, take: limit,
        include: { record: { select: { id: true, recordNumber: true, title: true } } },
        orderBy: { createdAt: 'desc' },
      }),
      prisma.notification.count({ where }),
      prisma.notification.count({ where: { userId, tenantId: req.user!.tenantId, isRead: false } }),
    ]);

    res.json({ success: true, notifications, unreadCount, pagination: { page, limit, total } });
  } catch (err) { next(err); }
});

// GET /notifications/inbox/count — just the unread count (for bell badge)
router.get('/count', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const count = await prisma.notification.count({
      where: { userId: req.user!.sub, tenantId: req.user!.tenantId, isRead: false },
    });
    res.json({ success: true, unreadCount: count });
  } catch (err) { next(err); }
});

// PATCH /notifications/inbox/:id/read — mark one as read
router.patch('/:id/read', async (req: Request, res: Response, next: NextFunction) => {
  try {
    await prisma.notification.updateMany({
      where: { id: req.params.id, userId: req.user!.sub },
      data: { isRead: true, readAt: new Date() },
    });
    res.json({ success: true });
  } catch (err) { next(err); }
});

// POST /notifications/inbox/read-all — mark all as read
router.post('/read-all', async (req: Request, res: Response, next: NextFunction) => {
  try {
    await prisma.notification.updateMany({
      where: { userId: req.user!.sub, tenantId: req.user!.tenantId, isRead: false },
      data: { isRead: true, readAt: new Date() },
    });
    res.json({ success: true });
  } catch (err) { next(err); }
});

export default router;
