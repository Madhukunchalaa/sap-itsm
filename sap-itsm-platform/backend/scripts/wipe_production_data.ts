import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient({
  datasources: {
    db: {
      url: 'postgresql://postgres:YaUaooNTJoIDDmVbZABkwDeytcOBSguy@tramway.proxy.rlwy.net:31692/railway',
    },
  },
});

async function safeDelete(name: string, deleteFn: () => Promise<any>) {
  console.log(`🗑️ Deleting ${name}...`);
  try {
    const result = await deleteFn();
    console.log(`✅ Deleted ${result.count || 0} records from ${name}.`);
  } catch (err) {
    console.error(`❌ Failed to delete from ${name}:`, err.message);
  }
}

async function main() {
  console.log('🚀 Starting targeted PRODUCTION data wipe on Railway (Enhanced Logging)...');

  // Deletion in dependency order
  await safeDelete('SLAPauseHistory', () => prisma.sLAPauseHistory.deleteMany({}));
  await safeDelete('SLATracking', () => prisma.sLATracking.deleteMany({}));
  await safeDelete('TimeEntry', () => prisma.timeEntry.deleteMany({}));
  await safeDelete('Comment', () => prisma.comment.deleteMany({}));
  await safeDelete('EmailLog', () => prisma.emailLog.deleteMany({}));
  await safeDelete('Notification', () => prisma.notification.deleteMany({}));
  await safeDelete('AuditLog', () => prisma.auditLog.deleteMany({}));
  await safeDelete('ITSMRecord', () => prisma.iTSMRecord.deleteMany({}));
  
  await safeDelete('AgentSpecialization', () => prisma.agentSpecialization.deleteMany({}));
  await safeDelete('CustomerAgent', () => prisma.customerAgent.deleteMany({}));
  
  console.log('🔄 Clearing PM references from Customers...');
  try {
    await prisma.customer.updateMany({ data: { projectManagerAgentId: null } });
    console.log('✅ PM references cleared.');
  } catch (err) {
    console.error('❌ Failed to clear PM references:', err.message);
  }

  await safeDelete('Agent', () => prisma.agent.deleteMany({}));
  
  await safeDelete('RefreshTokens (non-admin)', () => prisma.refreshToken.deleteMany({
    where: { user: { role: { not: 'SUPER_ADMIN' } } }
  }));
  
  await safeDelete('NotificationPreferences (non-admin)', () => prisma.notificationPreference.deleteMany({
    where: { user: { role: { not: 'SUPER_ADMIN' } } }
  }));

  await safeDelete('Users (non-admin)', () => prisma.user.deleteMany({
    where: { role: { not: 'SUPER_ADMIN' } }
  }));

  console.log('✅ Targeted wipe attempt completed.');
  await prisma.$disconnect();
}

main();
