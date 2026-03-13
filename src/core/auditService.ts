import { StateMemory } from '../agents/stateMemory.js';
import { createLogger } from './logger.js';

export class AuditService {
  private logger = createLogger('AuditService');

  constructor(private memory: StateMemory) {}

  
  logAction(userId: string | null, action: string, targetUrl?: string): void {
    
    this.memory.pool.query(
      `INSERT INTO audit_logs (user_id, action, target_url) VALUES ($1, $2, $3)`,
      [userId, action, targetUrl || null]
    ).catch(err => {
      this.logger.error(`Failed to write audit log: ${err.message}`);
    });
  }

  async getRecentLogs(limit: number = 50, offset: number = 0) {
    const res = await this.memory.pool.query(
      `SELECT a.id, a.action, a.target_url, a.created_at, u.email as user_email
       FROM audit_logs a
       LEFT JOIN users u ON a.user_id = u.id
       ORDER BY a.created_at DESC
       LIMIT $1 OFFSET $2`,
      [limit, offset]
    );
    return res.rows;
  }
}
