import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient({
  datasources: {
    db: {
      url: 'postgresql://postgres:YaUaooNTJoIDDmVbZABkwDeytcOBSguy@tramway.proxy.rlwy.net:31692/railway',
    },
  },
});

async function verify() {
  console.log('🔍 Verifying PRODUCTION database state...');
  try {
    const users = await prisma.user.count();
    const admins = await prisma.user.count({ where: { role: 'SUPER_ADMIN' } });
    const agents = await prisma.agent.count();
    const tickets = await prisma.iTSMRecord.count();

    console.log('--- Production Report ---');
    console.log(`Total Users: ${users}`);
    console.log(`Admin Users (SUPER_ADMIN): ${admins}`);
    console.log(`Agent Profiles: ${agents}`);
    console.log(`ITSM Records (Tickets): ${tickets}`);
    console.log('---------------------------');
  } catch (err) {
    console.error('❌ Verification failed:', err.message);
  } finally {
    await prisma.$disconnect();
  }
}

verify();
