import 'dotenv/config';
import app from './app';
import { logger } from './config/logger';
import { prisma } from './config/database';
import { redis } from './config/redis';
import { startSLAWorker } from './workers/sla.worker';
import { startEmailWorker } from './workers/email.worker';
import { startEscalationWorker } from './workers/escalation.worker';
import { seedDatabase } from './seed';
import bcrypt from 'bcryptjs';

const PORT = parseInt(process.env.PORT || '3001', 10);

// ── Full reset: wipe everything, create Intraedge + admin@intraedge.com ──
async function resetAndReseed() {
  // Safety guard: if Intraedge tenant already exists, skip to prevent accidental wipes
  // Override with FORCE_RESET=true to bypass when you need a clean slate
  const existing = await prisma.tenant.findFirst({ where: { slug: 'intraedge' } });
  if (existing && !process.env.FORCE_RESET) {
    logger.info('ℹ️  Intraedge tenant already exists — skipping reset. Remove RESET_AND_RESEED from env vars.');
    return;
  }
  logger.info('⚠️  RESET_AND_RESEED + FORCE_RESET — wiping all data...');

  await prisma.sLAPauseHistory.deleteMany({});
  await prisma.sLATracking.deleteMany({});
  await prisma.timeEntry.deleteMany({});
  await prisma.comment.deleteMany({});
  await prisma.emailLog.deleteMany({});
  await prisma.iTSMRecord.deleteMany({});
  await prisma.auditLog.deleteMany({});
  await prisma.configurationItem.deleteMany({});

  // Contract relations
  try { await prisma.contractHolidayCalendar.deleteMany({}); } catch {}
  await prisma.contractShift.deleteMany({});
  await prisma.contract.deleteMany({});
  try { await (prisma as any).customerAgent.deleteMany({}); } catch {}
  try { await (prisma as any).sLAPolicyMaster.deleteMany({}); } catch {}
  try { await (prisma as any).supportTypeMaster.deleteMany({}); } catch {}

  await prisma.customer.deleteMany({});
  await prisma.agent.deleteMany({});
  await prisma.refreshToken.deleteMany({});
  await prisma.user.deleteMany({});

  // Holiday & shift cleanup
  try { await prisma.holidayDate.deleteMany({}); } catch {}
  try { await prisma.holidayCalendar.deleteMany({}); } catch {}
  await prisma.shift.deleteMany({});

  await prisma.tenant.deleteMany({});
  logger.info('✅ All data wiped.');

  // Create Intraedge tenant
  const tenant = await prisma.tenant.create({
    data: {
      name:     'Intraedge',
      slug:     'intraedge',
      timezone: 'Asia/Kolkata',
      country:  'IN',
      status:   'ACTIVE',
      settings: { maxUsers: 500, features: ['sla', 'email', 'cmdb', 'shifts', 'holidays'] },
    },
  });
  logger.info(`✅ Tenant created: ${tenant.name}`);

  // Create Super Admin
  const passwordHash = await bcrypt.hash('Admin@123456', 12);
  const admin = await prisma.user.create({
    data: {
      tenantId:     tenant.id,
      email:        'admin@intraedge.com',
      passwordHash,
      firstName:    'System',
      lastName:     'Administrator',
      role:         'SUPER_ADMIN',
      status:       'ACTIVE',
    },
  });
  logger.info(`✅ Super Admin: ${admin.email} / Admin@123456`);
  logger.info('🎉 Reset complete — login with admin@intraedge.com / Admin@123456');
}

async function bootstrap() {
  try {
    await prisma.$connect();
    logger.info('✅ PostgreSQL connected');

    // RESET_AND_RESEED takes priority — wipes everything and creates fresh admin
    if (process.env.RESET_AND_RESEED === 'true') {
      await resetAndReseed();
    } else if (process.env.SEED_ON_BOOT === 'true') {
      try {
        await seedDatabase();
        logger.info('✅ Seed complete');
      } catch (e: any) {
        logger.warn('Seed skipped:', e?.message || e);
      }
    }

    await redis.ping();
    logger.info('✅ Redis connected');

    startSLAWorker();
    startEmailWorker();
    startEscalationWorker();
    logger.info('✅ Workers started');

    app.listen(PORT, '0.0.0.0', () => {
      logger.info(`✅ Server running on port ${PORT} [${process.env.NODE_ENV}]`);
    });
  } catch (error) {
    logger.error('❌ Startup failed:', error);
    process.exit(1);
  }
}

process.on('SIGTERM', async () => {
  await prisma.$disconnect();
  await redis.quit();
  process.exit(0);
});

process.on('SIGINT', async () => {
  await prisma.$disconnect();
  await redis.quit();
  process.exit(0);
});

bootstrap();
