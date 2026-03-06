import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

interface AgentScore {
  agentId: string;
  agentName: string;
  level: string;
  moduleMatch: number;
  subModuleMatch: number;
  levelScore: number;
  workloadScore: number;
  availabilityScore: number;
  totalScore: number;
  openTickets: number;
  maxConcurrent: number;
  status: string;
}

// Level priority mapping: P1→L4/L3 best, P4→L1/L2 best
const LEVEL_PRIORITY_SCORES: Record<string, Record<string, number>> = {
  P1: { L4: 25, L3: 20, L2: 10, L1: 5 },
  P2: { L4: 20, L3: 25, L2: 15, L1: 5 },
  P3: { L4: 5,  L3: 10, L2: 25, L1: 20 },
  P4: { L4: 5,  L3: 5,  L2: 20, L1: 25 },
};

export async function findMatchingRule(params: {
  tenantId: string;
  customerId: string;
  recordType: string;
  priority: string;
  sapModuleId?: string | null;
}) {
  const { tenantId, customerId, recordType, priority, sapModuleId } = params;

  // Find matching rules ordered by specificity (most specific first)
  const rules = await prisma.assignmentRule.findMany({
    where: {
      tenantId,
      customerId,
      isActive: true,
    },
    include: {
      customer: { select: { companyName: true } },
      sapModule: { select: { code: true, name: true } },
    },
    orderBy: { sortOrder: 'asc' },
  });

  // Score rules by specificity and find best match
  for (const rule of rules) {
    const typeMatch = !rule.recordType || rule.recordType === recordType;
    const priorityMatch = !rule.priority || rule.priority === priority;
    const moduleMatch = !rule.sapModuleId || rule.sapModuleId === sapModuleId;

    if (typeMatch && priorityMatch && moduleMatch) {
      return rule;
    }
  }

  return null;
}

export async function scoreAgents(params: {
  tenantId: string;
  customerId: string;
  priority: string;
  sapModuleId?: string | null;
  sapSubModuleId?: string | null;
  preferredLevel?: string | null;
}): Promise<AgentScore[]> {
  const { tenantId, customerId, priority, sapModuleId, sapSubModuleId, preferredLevel } = params;

  // Get agents assigned to this customer
  const customerAgents = await prisma.customerAgent.findMany({
    where: { customerId },
    select: { agentId: true },
  });
  const agentIds = customerAgents.map(ca => ca.agentId);

  if (agentIds.length === 0) return [];

  // Load agent details with specializations and open ticket counts
  const agents = await prisma.agent.findMany({
    where: {
      id: { in: agentIds },
      user: { tenantId, status: 'ACTIVE' },
      agentType: 'AGENT',
    },
    include: {
      user: { select: { firstName: true, lastName: true } },
      specializations: { select: { sapModuleId: true, sapSubModuleIds: true } },
      _count: {
        select: {
          assignments: {
            where: { status: { in: ['NEW', 'OPEN', 'IN_PROGRESS'] } },
          },
        },
      },
    },
  });

  const scores: AgentScore[] = agents.map(agent => {
    // Module match (30 pts)
    let moduleMatch = 0;
    if (sapModuleId) {
      const spec = agent.specializations.find(s => s.sapModuleId === sapModuleId);
      if (spec) moduleMatch = 30;
    }

    // Sub-module match (20 pts)
    let subModuleMatch = 0;
    if (sapModuleId && sapSubModuleId) {
      const spec = agent.specializations.find(s => s.sapModuleId === sapModuleId);
      if (spec && spec.sapSubModuleIds.includes(sapSubModuleId)) subModuleMatch = 20;
    }

    // Level score (25 pts) — higher priority for level match
    let levelScore = 0;
    if (preferredLevel) {
      // Explicit preferred level from rule
      levelScore = agent.level === preferredLevel ? 25 : (
        Math.abs(['L1','L2','L3','L4'].indexOf(agent.level) - ['L1','L2','L3','L4'].indexOf(preferredLevel)) <= 1 ? 15 : 5
      );
    } else {
      // Auto: use priority-based scoring
      levelScore = LEVEL_PRIORITY_SCORES[priority]?.[agent.level] || 10;
    }

    // Workload score (15 pts)
    const openTickets = (agent._count as any).assignments || 0;
    const maxC = agent.maxConcurrent || 5;
    const utilizationPct = openTickets / maxC;
    const workloadScore = utilizationPct >= 1.0 ? 0 : Math.round((1 - utilizationPct) * 15);

    // Availability score (10 pts)
    const availabilityScore = agent.status === 'AVAILABLE' ? 10 : agent.status === 'BUSY' ? 5 : 0;

    const totalScore = moduleMatch + subModuleMatch + levelScore + workloadScore + availabilityScore;

    return {
      agentId: agent.id,
      agentName: `${agent.user.firstName} ${agent.user.lastName}`,
      level: agent.level,
      moduleMatch,
      subModuleMatch,
      levelScore,
      workloadScore,
      availabilityScore,
      totalScore,
      openTickets,
      maxConcurrent: maxC,
      status: agent.status,
    };
  });

  // Sort by total score descending, then by workload (fewer tickets first for tie-breaking)
  scores.sort((a, b) => b.totalScore - a.totalScore || a.openTickets - b.openTickets);

  return scores;
}

// Round-robin: pick the agent with fewest open tickets (simple load balancing)
export async function roundRobinAgent(params: {
  tenantId: string;
  customerId: string;
  sapModuleId?: string | null;
}): Promise<AgentScore | null> {
  const scores = await scoreAgents({
    ...params,
    priority: 'P3', // neutral priority for round-robin
  });

  // Filter to available agents only, sort by workload
  const available = scores.filter(s => s.status !== 'OFFLINE' && s.openTickets < s.maxConcurrent);
  if (available.length === 0) return null;

  // Sort by open tickets ascending (least loaded first)
  available.sort((a, b) => a.openTickets - b.openTickets);
  return available[0];
}
