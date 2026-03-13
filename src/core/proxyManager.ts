import { createLogger } from './logger.js';

export interface ProxyInstance {
  url: string; 
  failures: number;
}

const MAX_FAILURES = 3;

export class ProxyManager {
  private proxies: ProxyInstance[] = [];
  private logger = createLogger('ProxyManager');

  constructor(proxyUrls: string[]) {
    this.proxies = proxyUrls.map(url => ({ url, failures: 0 }));
    this.logger.info(`Initialized ProxyManager with ${this.proxies.length} proxies`);
  }

  getHealthyProxy(): ProxyInstance | null {
    const healthy = this.proxies.filter(p => p.failures < MAX_FAILURES);
    if (healthy.length === 0) {
      if (this.proxies.length > 0) {
         this.logger.warn('All proxies are currently failing. Falling back to none or potentially resetting failures.');
      }
      return null;
    }
    
    return healthy[Math.floor(Math.random() * healthy.length)];
  }

  reportFailure(proxyUrl: string): void {
    const proxy = this.proxies.find(p => p.url === proxyUrl);
    if (proxy) {
      proxy.failures++;
      this.logger.warn(`Proxy ${proxyUrl} failed (attempt ${proxy.failures}/${MAX_FAILURES})`);
    }
  }

  reportSuccess(proxyUrl: string): void {
    const proxy = this.proxies.find(p => p.url === proxyUrl);
    if (proxy && proxy.failures > 0) {
      proxy.failures = 0; 
      this.logger.info(`Proxy ${proxyUrl} recovered and marked as healthy`);
    }
  }
}
