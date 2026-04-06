import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const users = await prisma.user.findMany({
    select: {
      id: true,
      firstName: true,
      lastName: true,
      email: true,
      role: true,
      status: true,
      tenant: {
        select: { name: true },
      },
      customer: {
        select: { companyName: true },
      },
    },
    orderBy: { createdAt: 'asc' },
  });

  console.log(`\nTotal users: ${users.length}\n`);
  console.log('─'.repeat(80));

  for (const u of users) {
    console.log(`Name     : ${u.firstName} ${u.lastName}`);
    console.log(`Email    : ${u.email}`);
    console.log(`Role     : ${u.role}`);
    console.log(`Status   : ${u.status}`);
    console.log(`Tenant   : ${u.tenant.name}`);
    console.log(`Company  : ${u.customer?.companyName ?? '(no company)'}`);
    console.log('─'.repeat(80));
  }
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
