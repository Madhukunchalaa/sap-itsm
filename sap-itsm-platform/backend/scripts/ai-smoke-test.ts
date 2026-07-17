// Read-only smoke test for the AI triage/suggestion/report services.
// Runs against DATABASE_URL from .env â€” performs NO writes.
//   npx ts-node -T scripts/ai-smoke-test.ts
import 'dotenv/config';
process.env.NO_REDIS = 'true';

import { prisma } from '../src/config/database';

async function main() {
  const { findSimilarTicketsLexical: findSimilarTickets } = await import('../src/services/similarity.service');
  const { buildTriageSuggestions } = await import('../src/services/triage.service');
  const { generateOverallReport } = await import('../src/services/report.service');

  const tenant = await prisma.tenant.findFirst({ select: { id: true, name: true } });
  if (!tenant) throw new Error('No tenant found');
  console.log(`\n=== Tenant: ${tenant.name} (${tenant.id}) ===`);

  const counts = await prisma.iTSMRecord.groupBy({ by: ['status'], where: { tenantId: tenant.id }, _count: true });
  console.log('Ticket counts by status:', counts.map(c => `${c.status}=${c._count}`).join(', '));

  // 1. Similarity â€” use a real open ticket's text as the query
  const sample = await prisma.iTSMRecord.findFirst({
    where: { tenantId: tenant.id },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true, recordNumber: true, title: true, description: true, recordType: true,
      priority: true, customerId: true, sapModuleId: true, sapSubModuleId: true, assignedAgentId: true,
    },
  });
  if (!sample) throw new Error('No tickets found');
  console.log(`\n--- 1. Similar tickets for: [${sample.recordNumber}] "${sample.title}" ---`);
  const t0 = Date.now();
  const similar = await findSimilarTickets(tenant.id, `${sample.title} ${sample.description}`, { topK: 5, excludeRecordId: sample.id });
  console.log(`(${Date.now() - t0}ms)`);
  for (const s of similar) {
    console.log(`  ${Math.round(s.score * 100)}%  ${s.recordNumber}  "${s.title}"${s.resolutionHint ? `\n        hint: ${s.resolutionHint.replace(/\s+/g, ' ').slice(0, 100)}` : ''}`);
  }
  if (similar.length === 0) console.log('  (no matches above threshold)');

  // 2. Full triage suggestions
  console.log(`\n--- 2. Triage suggestions for ${sample.recordNumber} ---`);
  const t1 = Date.now();
  const triage = await buildTriageSuggestions({ ...sample, tenantId: tenant.id, recordId: sample.id });
  console.log(`(${Date.now() - t1}ms)`);
  console.log(`  Priority: suggested=${triage.priority.suggested} current=${triage.priority.current} confidence=${triage.priority.confidence} signals=[${triage.priority.signals.join(', ')}]`);
  console.log(`  Modules: ${triage.module.suggestions.map(m => `${m.code}(${m.score})`).join(', ') || 'none'}`);
  console.log(`  Agents: ${triage.agents.map(a => `${a.agentName}[${a.level}] score=${a.totalScore} (${a.reasons.join('; ')})`).join(' | ') || 'none'}`);
  console.log(`  Similar: ${triage.similarTickets.length} found (source: ${triage.similarSource})`);

  // 3. Overall report
  console.log('\n--- 3. Overall report (month) ---');
  const t2 = Date.now();
  const report = await generateOverallReport(tenant.id, 'month');
  console.log(`(${Date.now() - t2}ms)`);
  console.log(`  Created: ${report.volumes.created} (prev ${report.volumes.createdPreviousPeriod}, delta ${report.volumes.deltaPct}%)`);
  console.log(`  Resolved: ${report.volumes.resolved} | Backlog: ${report.volumes.openBacklog}`);
  console.log(`  SLA: tracked=${report.sla.tracked} breachResp=${report.sla.breachedResponse} breachRes=${report.sla.breachedResolution} compliance=${report.sla.complianceRate}`);
  console.log(`  Avg resolution: ${report.performance.avgResolutionHours}h`);
  console.log(`  Agents: ${report.performance.agents.map(a => `${a.agentName}=${a.resolved}`).join(', ') || 'none'}`);
  console.log(`  Top modules: ${report.hotspots.topModules.map(m => `${m.code}=${m.count}`).join(', ') || 'none'}`);
  console.log(`\n  Narrative: ${report.narrative}`);

  console.log('\nâœ… Smoke test complete (read-only).');
}

main()
  .catch(err => { console.error('âŒ Smoke test failed:', err); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());

