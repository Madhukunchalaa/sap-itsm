import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient({
  datasources: {
    db: {
      url: 'postgresql://postgres:YaUaooNTJoIDDmVbZABkwDeytcOBSguy@tramway.proxy.rlwy.net:31692/railway',
    },
  },
});

async function audit() {
  console.log('🔍 Final Audit of PROVIDED Railway Database...');
  try {
    const tenants = await prisma.tenant.findMany({
      select: { id: true, name: true, slug: true }
    });
    console.log('🏢 Tenants in DB:', tenants);

    const tickets = await prisma.iTSMRecord.findMany({
      take: 10,
      select: { id: true, recordNumber: true, title: true, status: true }
    });
    console.log(`🎫 Tickets found (${tickets.length}):`, tickets);

    const userCount = await prisma.user.count();
    const adminCount = await prisma.user.count({ where: { role: 'SUPER_ADMIN' } });
    console.log(`👤 Users: ${userCount} (Admins: ${adminCount})`);

  } catch (err) {
    console.error('❌ Audit failed:', err.message);
  } finally {
    await prisma.$disconnect();
  }
}

audit();
