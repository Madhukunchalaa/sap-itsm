
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function check() {
  const tenants = await prisma.tenant.findMany();
  console.log('Tenants:', tenants.map(t => ({ id: t.id, name: t.name, slug: t.slug })));
  
  const users = await prisma.user.findMany({ select: { id: true, email: true, role: true } });
  console.log('Users:', users);

  const agents = await prisma.agent.findMany({ include: { user: { select: { email: true } } } });
  console.log('Agents:', agents.map(a => ({ id: a.id, email: a.user.email })));

  const customers = await prisma.customer.findMany();
  console.log('Customers:', customers.map(c => ({ id: c.id, name: c.companyName })));

  const modules = await prisma.sAPModuleMaster.findMany();
  console.log('Modules:', modules.map(m => ({ id: m.id, code: m.code })));
}

check().then(() => prisma.$disconnect());
