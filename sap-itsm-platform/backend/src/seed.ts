import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

export async function seedDatabase() {
  const existing = await prisma.tenant.findFirst({ where: { slug: 'acme-corp' } });
  if (existing) {
    console.log('Database already seeded, skipping.');
    return;
  }

  const tenant = await prisma.tenant.create({
    data: {
      name: 'ACME Corporation',
      slug: 'acme-corp',
      timezone: 'America/New_York',
      country: 'US',
      status: 'ACTIVE',
      settings: { maxUsers: 100, features: ['sla', 'email', 'cmdb'] },
    },
  });

  const pw = await bcrypt.hash('Admin@123456', 12);

  const superAdmin = await prisma.user.create({
    data: {
      tenantId: tenant.id,
      email: 'superadmin@itsm.local',
      passwordHash: pw,
      firstName: 'Super',
      lastName: 'Admin',
      role: 'SUPER_ADMIN',
      status: 'ACTIVE',
    },
  });

  const admin = await prisma.user.create({
    data: {
      tenantId: tenant.id,
      email: 'admin@acme.com',
      passwordHash: pw,
      firstName: 'Company',
      lastName: 'Admin',
      role: 'COMPANY_ADMIN',
      status: 'ACTIVE',
    },
  });

  const agent1User = await prisma.user.create({
    data: {
      tenantId: tenant.id,
      email: 'agent1@acme.com',
      passwordHash: pw,
      firstName: 'Alice',
      lastName: 'Johnson',
      role: 'AGENT',
      status: 'ACTIVE',
    },
  });

  const agent2User = await prisma.user.create({
    data: {
      tenantId: tenant.id,
      email: 'agent2@acme.com',
      passwordHash: pw,
      firstName: 'Bob',
      lastName: 'Smith',
      role: 'AGENT',
      status: 'ACTIVE',
    },
  });

  const agent1 = await prisma.agent.create({
    data: {
      userId: agent1User.id,
      level: 'L2',
      specialization: 'SAP Basis',
      status: 'AVAILABLE',
    },
  });

  const agent2 = await prisma.agent.create({
    data: {
      userId: agent2User.id,
      level: 'L1',
      specialization: 'General Support',
      status: 'AVAILABLE',
    },
  });

  const customer = await prisma.customer.create({
    data: {
      tenantId: tenant.id,
      companyName: 'TechCorp Industries',
      industry: 'Technology',
      country: 'US',
      timezone: 'America/New_York',
      status: 'ACTIVE',
    },
  });

  const contract = await prisma.contract.create({
    data: {
      customerId: customer.id,
      contractNumber: 'CTR-2024-001',
      startDate: new Date('2024-01-01'),
      endDate: new Date('2024-12-31'),
      billingAmount: 50000,
      currency: 'USD',
    },
  });

  // Create sample tickets
  for (let i = 1; i <= 5; i++) {
    await prisma.iTSMRecord.create({
      data: {
        tenantId: tenant.id,
        recordType: 'INCIDENT',
        recordNumber: `INC-2024-${String(i).padStart(4, '0')}`,
        title: `Sample Incident ${i}`,
        description: `This is a sample incident ticket number ${i} for demo purposes.`,
        priority: ['P1', 'P2', 'P3', 'P4', 'P3'][i - 1] as any,
        status: ['NEW', 'OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED'][i - 1] as any,
        customerId: customer.id,
        contractId: contract.id,
        assignedAgentId: i <= 3 ? agent1.id : agent2.id,
        createdById: admin.id,
      },
    });
  }

  console.log('✅ Database seeded with demo data');
}
