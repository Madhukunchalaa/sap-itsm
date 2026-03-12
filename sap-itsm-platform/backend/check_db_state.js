
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function check() {
  try {
    const tenants = await prisma.tenant.findMany();
    console.log('TENANTS:', JSON.stringify(tenants.map(t => ({ id: t.id, name: t.name, slug: t.slug }))));
    
    const users = await prisma.user.findMany({ select: { id: true, email: true, role: true } });
    console.log('USERS:', JSON.stringify(users));

    const agents = await prisma.agent.findMany({ include: { user: { select: { email: true } } } });
    console.log('AGENTS:', JSON.stringify(agents.map(a => ({ id: a.id, email: a.user.email }))));

    const customers = await prisma.customer.findMany();
    console.log('CUSTOMERS:', JSON.stringify(customers.map(c => ({ id: c.id, name: c.companyName }))));

    const modules = await prisma.sAPModuleMaster.findMany();
    console.log('MODULES:', JSON.stringify(modules.map(m => ({ id: m.id, code: m.code }))));
  } catch (e) {
    console.error(e);
  } finally {
    await prisma.$disconnect();
  }
}

check();
