import { PrismaClient, UserRole, Priority, RecordType } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Seeding SAP ITSM Platform...');

  // ── Tenant ────────────────────────────────────────────────
  const tenant = await prisma.tenant.upsert({
    where: { slug: 'acme-corp' },
    update: {},
    create: {
      name: 'ACME Corporation',
      slug: 'acme-corp',
      timezone: 'America/New_York',
      country: 'US',
      status: 'ACTIVE',
      settings: { maxUsers: 100, features: ['sla', 'email', 'cmdb'] },
    },
  });
  console.log('✅ Tenant:', tenant.name);

  const pw = await bcrypt.hash('Admin@123456', 12);

  // ── Users ─────────────────────────────────────────────────
  const superAdmin = await prisma.user.upsert({
    where: { email: 'superadmin@itsm.local' },
    update: {},
    create: {
      tenantId: tenant.id,
      email: 'superadmin@itsm.local',
      passwordHash: pw,
      firstName: 'Super',
      lastName: 'Admin',
      role: 'SUPER_ADMIN',
      status: 'ACTIVE',
    },
  });

  // NOTE: customerId is set AFTER customer creation below
  const companyAdmin = await prisma.user.upsert({
    where: { email: 'admin@acme.com' },
    update: {},
    create: {
      tenantId: tenant.id,
      email: 'admin@acme.com',
      passwordHash: pw,
      firstName: 'John',
      lastName: 'Admin',
      role: 'COMPANY_ADMIN',
      status: 'ACTIVE',
    },
  });

  const agentUser1 = await prisma.user.upsert({
    where: { email: 'agent1@acme.com' },
    update: {},
    create: {
      tenantId: tenant.id,
      email: 'agent1@acme.com',
      passwordHash: pw,
      firstName: 'Alice',
      lastName: 'Agent',
      role: 'AGENT',
      status: 'ACTIVE',
    },
  });

  const agentUser2 = await prisma.user.upsert({
    where: { email: 'agent2@acme.com' },
    update: {},
    create: {
      tenantId: tenant.id,
      email: 'agent2@acme.com',
      passwordHash: pw,
      firstName: 'Bob',
      lastName: 'Support',
      role: 'AGENT',
      status: 'ACTIVE',
    },
  });

  const pmUser = await prisma.user.upsert({
    where: { email: 'pm@acme.com' },
    update: {},
    create: {
      tenantId: tenant.id,
      email: 'pm@acme.com',
      passwordHash: pw,
      firstName: 'Carol',
      lastName: 'PM',
      role: 'PROJECT_MANAGER',
      status: 'ACTIVE',
    },
  });

  // NOTE: customerId is set AFTER customer creation below
  const endUser = await prisma.user.upsert({
    where: { email: 'user@acme.com' },
    update: {},
    create: {
      tenantId: tenant.id,
      email: 'user@acme.com',
      passwordHash: pw,
      firstName: 'Dave',
      lastName: 'User',
      role: 'USER',
      status: 'ACTIVE',
    },
  });

  console.log('✅ Users created (password: Admin@123456)');

  // ── Agents (including PM — PM needs an Agent record) ──────
  const agent1 = await prisma.agent.upsert({
    where: { userId: agentUser1.id },
    update: {},
    create: {
      userId: agentUser1.id,
      specialization: 'SAP Basis',
      level: 'L2',
      timezone: 'America/New_York',
      maxConcurrent: 8,
      status: 'AVAILABLE',
    },
  });

  const agent2 = await prisma.agent.upsert({
    where: { userId: agentUser2.id },
    update: {},
    create: {
      userId: agentUser2.id,
      specialization: 'SAP ABAP',
      level: 'L3',
      timezone: 'America/Chicago',
      maxConcurrent: 5,
      status: 'AVAILABLE',
    },
  });

  // PM also gets an Agent record so they can be resolved via resolveAgent()
  const pmAgent = await prisma.agent.upsert({
    where: { userId: pmUser.id },
    update: {},
    create: {
      userId: pmUser.id,
      specialization: 'Project Management',
      level: 'L3',
      timezone: 'America/New_York',
      maxConcurrent: 0,
      status: 'AVAILABLE',
    },
  });

  console.log('✅ Agents created (including PM agent)');

  // ── Shifts ────────────────────────────────────────────────
  const shift = await prisma.shift.create({
    data: {
      tenantId: tenant.id,
      name: 'Business Hours - EST',
      startTime: '08:00',
      endTime: '18:00',
      timezone: 'America/New_York',
      breakMinutes: 60,
      workDays: [1, 2, 3, 4, 5], // Mon-Fri
      supportType: 'BUSINESS_HOURS',
    },
  });
  console.log('✅ Shift created');

  // ── Customer ──────────────────────────────────────────────
  const customer = await prisma.customer.create({
    data: {
      tenantId: tenant.id,
      companyName: 'Beta Industries',
      industry: 'Manufacturing',
      country: 'US',
      timezone: 'America/New_York',
      status: 'ACTIVE',
      adminUserId: companyAdmin.id,
      projectManagerAgentId: pmAgent.id,
    },
  });
  console.log('✅ Customer created:', customer.companyName);

  // ── Link COMPANY_ADMIN and END USER to Customer ───────────
  await prisma.user.update({
    where: { id: companyAdmin.id },
    data: { customerId: customer.id },
  });
  await prisma.user.update({
    where: { id: endUser.id },
    data: { customerId: customer.id },
  });
  console.log('✅ COMPANY_ADMIN and USER linked to customer');

  // ── CustomerAgent join table — link PM and agents to customer ──
  await prisma.customerAgent.createMany({
    data: [
      { customerId: customer.id, agentId: pmAgent.id },
      { customerId: customer.id, agentId: agent1.id },
      { customerId: customer.id, agentId: agent2.id },
    ],
    skipDuplicates: true,
  });
  console.log('✅ CustomerAgent assignments created (PM + 2 agents → Beta Industries)');

  // ── Contract ──────────────────────────────────────────────
  const contract = await prisma.contract.create({
    data: {
      customerId: customer.id,
      contractNumber: `CON-2024-001`,
      contractType: 'GOLD',
      startDate: new Date('2024-01-01'),
      endDate: new Date('2024-12-31'),
      afterHoursMultiplier: 1.5,
      weekendMultiplier: 2.0,
      holidaySupport: true,
      autoRenewal: true,
      billingAmount: 50000,
      currency: 'USD',
      slaConfig: {
        P1: { response: 15, resolution: 240 },
        P2: { response: 60, resolution: 480 },
        P3: { response: 240, resolution: 1440 },
        P4: { response: 480, resolution: 2880 },
      },
      shifts: { create: { shiftId: shift.id } },
    },
  });
  console.log('✅ Contract created:', contract.contractNumber);

  // ── CMDB Items ────────────────────────────────────────────
  const ci = await prisma.configurationItem.create({
    data: {
      tenantId: tenant.id,
      ciType: 'SYSTEM',
      name: 'SAP ERP Production',
      environment: 'PROD',
      sid: 'PRD',
      hostname: 'sap-prod.acme.internal',
      version: 'S/4HANA 2023',
      status: 'ACTIVE',
    },
  });
  console.log('✅ CI created:', ci.name);

  // ── Sample ITSM Records ───────────────────────────────────
  const now = new Date();
  const sampleRecords = [
    {
      recordType: 'INCIDENT' as RecordType,
      title: 'SAP Production System Down - Users Cannot Login',
      description: 'All users are unable to access the SAP production system since 09:00 AM. Login screen shows "System not available" error. Business operations severely impacted.',
      priority: 'P1' as Priority,
      status: 'IN_PROGRESS' as any,
      assignedAgentId: agent1.id,
      slaTracking: {
        responseDeadline: new Date(now.getTime() + 10 * 60 * 1000),
        resolutionDeadline: new Date(now.getTime() + 3 * 60 * 60 * 1000),
        respondedAt: now,
      },
    },
    {
      recordType: 'INCIDENT' as RecordType,
      title: 'Batch Job ZFINMONTH Failing with Dump',
      description: 'Month-end financial batch job is failing with ABAP runtime error. Short dump: COMPUTE_INT_ZERODIVIDE. Last successful run was yesterday.',
      priority: 'P2' as Priority,
      status: 'OPEN' as any,
      assignedAgentId: agent2.id,
      slaTracking: {
        responseDeadline: new Date(now.getTime() + 45 * 60 * 1000),
        resolutionDeadline: new Date(now.getTime() + 7 * 60 * 60 * 1000),
      },
    },
    {
      recordType: 'REQUEST' as RecordType,
      title: 'New User Creation: john.smith@acme.com',
      description: 'Please create a new SAP user for John Smith, IT Department. Required roles: MM_BUYER, PR_APPROVER. Valid from 2024-03-01.',
      priority: 'P3' as Priority,
      status: 'NEW' as any,
      slaTracking: {
        responseDeadline: new Date(now.getTime() + 4 * 60 * 60 * 1000),
        resolutionDeadline: new Date(now.getTime() + 24 * 60 * 60 * 1000),
      },
    },
    {
      recordType: 'CHANGE' as RecordType,
      title: 'Transport DEVK123456: Fix tax calculation formula',
      description: 'Deploy transport request DEVK123456 to production. Contains fix for incorrect tax calculation in SD module. Tested in QA. CAB approved.',
      priority: 'P2' as Priority,
      status: 'PENDING' as any,
      assignedAgentId: agent2.id,
      slaTracking: {
        responseDeadline: new Date(now.getTime() + 2 * 60 * 60 * 1000),
        resolutionDeadline: new Date(now.getTime() + 8 * 60 * 60 * 1000),
        pausedAt: new Date(),
        pausedMinutes: 120,
      },
    },
    {
      recordType: 'PROBLEM' as RecordType,
      title: 'Recurring SAP memory overflow causing system slowness',
      description: 'Root cause analysis for recurring memory overflow issues. 5 incidents opened in last 30 days. Suspected memory leak in custom report ZREP_SALES_HEAVY.',
      priority: 'P2' as Priority,
      status: 'IN_PROGRESS' as any,
      assignedAgentId: agent1.id,
      slaTracking: {
        responseDeadline: new Date(now.getTime() - 60 * 60 * 1000),
        resolutionDeadline: new Date(now.getTime() + 5 * 60 * 60 * 1000),
        respondedAt: new Date(now.getTime() - 30 * 60 * 1000),
        breachResponse: true,
      },
    },
  ];

  let counter = 1;
  for (const rec of sampleRecords) {
    const { slaTracking, ...recordData } = rec;
    const prefixMap: Record<string, string> = {
      INCIDENT: 'INC', REQUEST: 'REQ', PROBLEM: 'PRB', CHANGE: 'CHG',
    };
    const prefix = prefixMap[recordData.recordType];
    const recordNumber = `${prefix}-2024-${String(counter++).padStart(6, '0')}`;

    await prisma.iTSMRecord.create({
      data: {
        tenantId: tenant.id,
        recordNumber,
        customerId: customer.id,
        contractId: contract.id,
        ciId: ci.id,
        createdById: endUser.id,
        ...recordData,
        slaTracking: { create: slaTracking },
      },
    });
  }
  console.log('✅ Sample ITSM records created');

  // ── Holiday Calendar ──────────────────────────────────────
  await prisma.holidayCalendar.create({
    data: {
      tenantId: tenant.id,
      name: 'US Federal Holidays 2024',
      country: 'US',
      year: 2024,
      dates: {
        create: [
          { date: new Date('2024-01-01'), name: "New Year's Day", supportType: 'EMERGENCY_ONLY' },
          { date: new Date('2024-07-04'), name: 'Independence Day', supportType: 'EMERGENCY_ONLY' },
          { date: new Date('2024-11-28'), name: 'Thanksgiving Day', supportType: 'NONE' },
          { date: new Date('2024-12-25'), name: 'Christmas Day', supportType: 'EMERGENCY_ONLY' },
        ],
      },
    },
  });
  console.log('✅ Holiday calendar created');

  console.log('\n🎉 Seed complete!');
  console.log('─────────────────────────────────────');
  console.log('Login credentials (all use password: Admin@123456)');
  console.log('  Super Admin:    superadmin@itsm.local  → sees everything');
  console.log('  Company Admin:  admin@acme.com         → sees Beta Industries only');
  console.log('  Agent L2:       agent1@acme.com        → sees assigned tickets only');
  console.log('  Agent L3:       agent2@acme.com        → sees assigned tickets only');
  console.log('  Project Mgr:    pm@acme.com            → sees Beta Industries (via CustomerAgent)');
  console.log('  End User:       user@acme.com          → sees own tickets only');
}

main()
  .then(() => prisma.$disconnect())
  .catch((e) => {
    console.error('❌ Seed failed:', e);
    prisma.$disconnect();
    process.exit(1);
  });
