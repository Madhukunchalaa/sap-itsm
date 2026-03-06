// SLA targets in minutes by contract type and priority
// Response time = time to first response
// Resolution time = time to fully resolve

export const SLA_TARGETS: Record<string, Record<string, { response: number; resolution: number }>> = {
  GOLD: {
    P1: { response: 15,   resolution: 240 },   // 15min response, 4hr resolution
    P2: { response: 60,   resolution: 480 },   // 1hr response,  8hr resolution
    P3: { response: 240,  resolution: 1440 },  // 4hr response,  24hr resolution
    P4: { response: 480,  resolution: 2880 },  // 8hr response,  48hr resolution
  },
  SILVER: {
    P1: { response: 30,   resolution: 480 },
    P2: { response: 120,  resolution: 960 },
    P3: { response: 480,  resolution: 2880 },
    P4: { response: 960,  resolution: 5760 },
  },
  BRONZE: {
    P1: { response: 60,   resolution: 960 },
    P2: { response: 240,  resolution: 1920 },
    P3: { response: 960,  resolution: 5760 },
    P4: { response: 1920, resolution: 11520 },
  },
};

// Status transitions that PAUSE the SLA clock
export const SLA_PAUSING_STATUSES = ['PENDING'];

// Status transitions that signal a RESPONSE was given
export const SLA_RESPONSE_STATUSES = ['IN_PROGRESS', 'PENDING', 'RESOLVED', 'CLOSED'];

// Status transitions that stop the SLA clock entirely
export const SLA_STOP_STATUSES = ['RESOLVED', 'CLOSED', 'CANCELLED'];

// Warn at this percentage of SLA elapsed
export const SLA_WARNING_THRESHOLD = 0.80; // 80%

export const jwtConfig = {
  accessSecret: process.env.JWT_ACCESS_SECRET || 'change-me-in-production-access',
  refreshSecret: process.env.JWT_REFRESH_SECRET || 'change-me-in-production-refresh',
  accessExpiry: process.env.JWT_ACCESS_EXPIRY || '15m',
  refreshExpiry: process.env.JWT_REFRESH_EXPIRY || '7d',
};

export const bcryptRounds = parseInt(process.env.BCRYPT_ROUNDS || '12', 10);
