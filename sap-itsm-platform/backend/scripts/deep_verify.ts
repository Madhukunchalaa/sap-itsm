import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient({
  datasources: {
    db: {
      url: 'postgresql://postgres:YaUaooNTJoIDDmVbZABkwDeytcOBSguy@tramway.proxy.rlwy.net:31692/railway',
    },
  },
});

async function deepVerify() {
  console.log('🔍 Deep Verification of PRODUCTION database...');
  try {
    // Check all tables we tried to wipe
    const results = await Promise.all([
      prisma.user.count(),
      prisma.agent.count(),
      prisma.iTSMRecord.count(),
      prisma.comment.count(),
      prisma.timeEntry.count(),
      prisma.sLATracking.count(),
      prisma.auditLog.count(),
      prisma.tenant.count(),
    ]);

    console.log('--- Deep Production Report ---');
    console.log(`Users: ${results[0]}`);
    console.log(`Agents: ${results[1]}`);
    console.log(`Tickets (ITSMRecord): ${results[2]}`);
    console.log(`Comments: ${results[3]}`);
    console.log(`Time Entries: ${results[4]}`);
    console.log(`SLA Tracking: ${results[5]}`);
    console.log(`Audit Logs: ${results[6]}`);
    console.log(`Tenants: ${results[7]}`);
    console.log('------------------------------');

    if (results[2] > 0) {
      console.log('⚠️ ALERT: Tickets still exist in this database!');
      const samples = await prisma.iTSMRecord.findMany({ take: 3, select: { recordNumber: true, title: true } });
      console.log('Samples:', samples);
    } else {
      console.log('✅ CONFIRMED: This database is empty of tickets.');
    }

  } catch (err) {
    console.error('❌ Deep verification failed:', err.message);
  } finally {
    await prisma.$disconnect();
  }
}

deepVerify();
