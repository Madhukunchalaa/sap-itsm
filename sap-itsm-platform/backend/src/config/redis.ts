import IORedis from 'ioredis';
import { logger } from './logger';

// Plain connection config for BullMQ (avoids ioredis version mismatch)
const getBullConnection = () => {
  if (process.env.REDIS_URL) {
    const url = new URL(process.env.REDIS_URL);
    return {
      host: url.hostname,
      port: parseInt(url.port || '6379', 10),
      password: url.password || undefined,
      username: url.username || undefined,
      db: url.pathname ? parseInt(url.pathname.replace('/', '') || '0', 10) : 0,
      maxRetriesPerRequest: null as null,
      enableReadyCheck: false,
      tls: url.protocol === 'rediss:' ? {} : undefined,
    };
  }
  return {
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT || '6379', 10),
    password: process.env.REDIS_PASSWORD || undefined,
    db: parseInt(process.env.REDIS_DB || '0', 10),
    maxRetriesPerRequest: null as null,
    enableReadyCheck: false,
  };
};

// IORedis instance for direct cache use
const createRedisClient = () => {
  const retryStrategy = (times: number) => {
    if (times > 10) return null;
    return Math.min(times * 200, 3000);
  };
  if (process.env.REDIS_URL) {
    return new IORedis(process.env.REDIS_URL, {
      maxRetriesPerRequest: null,
      enableReadyCheck: false,
      retryStrategy,
    });
  }
  return new IORedis({
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT || '6379', 10),
    password: process.env.REDIS_PASSWORD || undefined,
    db: parseInt(process.env.REDIS_DB || '0', 10),
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
    retryStrategy,
  });
};

export const redis = createRedisClient();

// Plain config object for BullMQ — avoids ioredis version type conflicts
export const bullConnection = getBullConnection();

redis.on('connect', () => logger.info('Redis: connected'));
redis.on('error', (err) => logger.error('Redis error:', err));
redis.on('reconnecting', () => logger.warn('Redis: reconnecting...'));

export const cache = {
  async get<T>(key: string): Promise<T | null> {
    const val = await redis.get(key);
    return val ? (JSON.parse(val) as T) : null;
  },
  async set(key: string, value: unknown, ttlSeconds = 300): Promise<void> {
    await redis.setex(key, ttlSeconds, JSON.stringify(value));
  },
  async del(key: string): Promise<void> {
    await redis.del(key);
  },
  async delPattern(pattern: string): Promise<void> {
    const keys = await redis.keys(pattern);
    if (keys.length > 0) await redis.del(...keys);
  },
  key: {
    tenant: (id: string) => `tenant:${id}`,
    user: (id: string) => `user:${id}`,
    record: (id: string) => `record:${id}`,
    slaConfig: (contractId: string) => `sla:config:${contractId}`,
    dashboard: (tenantId: string) => `dashboard:${tenantId}`,
  },
};
