// Runs schema sync + optional seed/reset on boot
import { execSync } from 'child_process';

async function startup() {
  console.log('Syncing database schema...');
  try {
    execSync('npx prisma db push --accept-data-loss', { stdio: 'inherit' });
    console.log('Schema sync complete.');
  } catch (e) {
    console.error('Schema sync failed:', e);
    process.exit(1);
  }

  // RESET_AND_RESEED=true — wipes ALL data, creates Intraedge + Admin@intraedge.com
  if (process.env.RESET_AND_RESEED === 'true') {
    console.log('\n⚠️  RESET_AND_RESEED=true — wiping all data and reseeding...');
    try {
      execSync('npx ts-node prisma/reset-seed.ts', { stdio: 'inherit' });
      console.log('Reset complete.');
    } catch (e) {
      console.error('Reset failed:', e);
      process.exit(1);
    }
    return;
  }

  // SEED_ON_BOOT=true — seed demo data (legacy)
  if (process.env.SEED_ON_BOOT === 'true') {
    console.log('Seeding demo data...');
    try {
      execSync('npx ts-node prisma/seed.ts', { stdio: 'inherit' });
      console.log('Seed complete.');
    } catch (e) {
      console.warn('Seed warning (may already be seeded):', e);
    }
  }
}

startup();
