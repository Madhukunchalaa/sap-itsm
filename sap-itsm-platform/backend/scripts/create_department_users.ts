import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

const tenantId = '839cd77a-3fdd-4dfd-9118-55176d067a68'; // ACME Corporation
const drillmecCustomerId = '2c24f324-1b10-4216-9806-1762a2cda878';
const meilCustomerId = '4ece637e-68af-4b40-ad6f-529684477427';

const usersToCreate = [
  {
    email: 'saikiran.m@drillmecinternational.com',
    firstName: 'Saikiran',
    lastName: 'M',
    customerId: drillmecCustomerId,
    moduleCode: 'SD',
  },
  {
    email: 'daljitsingh@meil.in',
    firstName: 'Daljit',
    lastName: 'Singh',
    customerId: meilCustomerId,
    moduleCode: 'PP',
  },
  {
    email: 'KSUNIL@meghaeng.com',
    firstName: 'Sunil',
    lastName: 'K',
    customerId: meilCustomerId,
    moduleCode: 'MM',
  },
  {
    email: 'sreenivasulu.s@drillmecinternational.com',
    firstName: 'Sreenivasulu',
    lastName: 'S',
    customerId: drillmecCustomerId,
    moduleCode: 'FICO',
  },
  {
    email: 'aakash@meghaeng.com',
    firstName: 'Aakash',
    lastName: 'K',
    customerId: meilCustomerId,
    moduleCode: 'PS',
  },
  {
    email: 'nagoor.shaik@drillmecinternational.com',
    firstName: 'Nagoor',
    lastName: 'Shaik',
    customerId: drillmecCustomerId,
    moduleCode: 'MM',
  },
  {
    email: 'sudheer.k@drillmecinternational.com',
    firstName: 'Sudheer',
    lastName: 'K',
    customerId: drillmecCustomerId,
    moduleCode: 'MM',
  },
];

async function main() {
  const passwordHash = await bcrypt.hash('User@123456', 12);

  for (const u of usersToCreate) {
    const moduleRecord = await prisma.sAPModuleMaster.findFirst({
      where: { tenantId, code: u.moduleCode },
    });

    if (!moduleRecord) {
      console.error(`Module ${u.moduleCode} not found!`);
      continue;
    }

    const created = await prisma.user.upsert({
      where: { email: u.email },
      update: {
        firstName: u.firstName,
        lastName: u.lastName,
        customerId: u.customerId,
        sapModuleId: moduleRecord.id,
        status: 'ACTIVE',
        role: 'USER',
      },
      create: {
        tenantId,
        email: u.email,
        passwordHash,
        firstName: u.firstName,
        lastName: u.lastName,
        customerId: u.customerId,
        sapModuleId: moduleRecord.id,
        status: 'ACTIVE',
        role: 'USER',
      },
    });

    console.log(`User created/updated: ${created.email} (Module: ${u.moduleCode})`);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
