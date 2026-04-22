import dotenv from 'dotenv';
dotenv.config();

export const sapConfig = {
  baseUrl: process.env.SAP_BASE_URL || '',
  client: process.env.SAP_CLIENT || '100',
  username: process.env.SAP_USERNAME || '',
  password: process.env.SAP_PASSWORD || '',
  mirroringEnabled: process.env.SAP_MIRRORING_ENABLED === 'true',
  
  // OData headers for Basic Auth
  getAuthHeader: () => {
    const auth = Buffer.from(`${sapConfig.username}:${sapConfig.password}`).toString('base64');
    return `Basic ${auth}`;
  },
  
  // Default headers for OData requests
  getHeaders: () => ({
    'Authorization': sapConfig.getAuthHeader(),
    'Content-Type': 'application/json',
    'Accept': 'application/json',
    'x-sap-client': sapConfig.client,
  }),
};
