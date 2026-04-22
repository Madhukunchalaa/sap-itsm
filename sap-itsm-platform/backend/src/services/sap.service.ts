import axios from 'axios';
import { sapConfig } from '../config/sap.config';
import { AppError } from '../utils/AppError';
import { logger } from '../config/logger';

export interface SAPIncidentPayload {
  ShortDescription: string;
  LongText: string;
  Urgency: string;
  Impact: string;
  FunctionalArea: string;
  ExternalId: string;
}

export class SAPService {
  /**
   * Pushes a ticket to SAP OData service to create an incident.
   */
  async createSAPIncident(ticket: any): Promise<string> {
    if (!sapConfig.mirroringEnabled) {
      logger.info(`[SAP] Mirroring is disabled for ticket ${ticket.recordNumber}`);
      return '';
    }

    const payload = this.mapTicketToSAP(ticket);
    const url = `${sapConfig.baseUrl}/IncidentSet`;

    try {
      logger.info(`[SAP] Exporting ticket ${ticket.recordNumber} to SAP...`);
      
      const response = await axios.post(url, payload, {
        headers: sapConfig.getHeaders(),
        timeout: 10000,
      });

      // Assuming SAP returns the new ID in the d.ObjectId or d.IncidentNumber field
      const sapId = response.data?.d?.IncidentNumber || response.data?.d?.ObjectId;
      
      if (!sapId) {
        logger.warn(`[SAP] Incident created but no ID returned from SAP for ticket ${ticket.recordNumber}`);
        return 'PENDING_REF';
      }

      logger.info(`[SAP] Successfully created SAP Incident ${sapId} for ticket ${ticket.recordNumber}`);
      return sapId;
    } catch (error: any) {
      const status = error.response?.status;
      const data = error.response?.data;
      
      logger.error(`[SAP] Failed to create incident in SAP: ${error.message}`, {
        status,
        errorData: data,
        ticketNumber: ticket.recordNumber,
      });

      throw new AppError(
        `SAP Integration Error: ${error.message}`,
        status || 500,
        'SAP_SYNC_FAILED'
      );
    }
  }

  /**
   * Maps ITSM Ticket internal fields to SAP OData field names.
   */
  private mapTicketToSAP(ticket: any): SAPIncidentPayload {
    // Priority Mapping: P1 -> 1 (Very High), P2 -> 2 (High), etc.
    const priorityCode = ticket.priority.replace('P', '') || '3';
    
    // Module Mapping: Map ITSM Module code to SAP functional area
    const moduleCode = ticket.sapModule?.code || 'BASIS';

    return {
      ShortDescription: ticket.title,
      LongText:         ticket.description,
      Urgency:          priorityCode,      // Simplified mapping
      Impact:           priorityCode,       // Simplified mapping
      FunctionalArea:   moduleCode,
      ExternalId:       ticket.id,         // Link back to ITSM
    };
  }
}

export const sapService = new SAPService();
