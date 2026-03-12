
import { PrismaClient } from '@prisma/client';

async function checkLocalDB() {
  const localUrl = 'postgresql://postgres:postgres@localhost:5432/itsm_db'; // guessing default names from docker-compose
  console.log(`Checking local DB: ${localUrl}`);
  
  const prisma = new PrismaClient({
    datasources: {
      db: { url: localUrl }
    }
  });

  try {
    const tenants = await prisma.$queryRaw`SELECT count(*) FROM tenants`;
    console.log('Found tenants in local DB:', tenants);
  } catch (e) {
    console.log('Could not connect or tables missing in local itsm_db. Trying default postgres db...');
    const prisma2 = new PrismaClient({
      datasources: {
        db: { url: 'postgresql://postgres:postgres@localhost:5432/postgres' }
      }
    });
    try {
        const dbs = await prisma2.$queryRaw`SELECT datname FROM pg_database`;
        console.log('Available databases:', dbs);
    } catch (e2) {
        console.error('Failed to connect to local Postgres at all.');
    } finally {
        await prisma2.$disconnect();
    }
  } finally {
    await prisma.$disconnect();
  }
}

checkLocalDB();
