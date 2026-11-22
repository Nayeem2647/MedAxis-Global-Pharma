import { describe, expect, it } from 'vitest';
import { SERVICES_COPY, type ServiceId } from '../../components/services/services-copy';

const EXPECTED_IDS: readonly ServiceId[] = [
  'cold-chain',
  'sourcing',
  'coa-support',
  'emergency-delivery',
  'bulk-order',
];

describe('B2B services copy and structure', () => {
  it.each(['en', 'zh'] as const)('provides complete domain copy without placeholders for %s', (lang) => {
    const copy = SERVICES_COPY[lang];
    expect(copy.tabs.map((tab) => tab.id)).toEqual(EXPECTED_IDS);
    expect(copy.services.map((service) => service.id)).toEqual(EXPECTED_IDS);
    expect(copy.workflow.steps).toHaveLength(4);
    expect(copy.faq.items).toHaveLength(4);
    expect(copy.coaModal.rows.length).toBeGreaterThanOrEqual(6);
    expect(copy.quoteModal.countries.length).toBeGreaterThanOrEqual(10);

    const serialized = JSON.stringify(copy).toLowerCase();
    expect(serialized).not.toContain('lorem ipsum');
    for (const service of copy.services) {
      expect(service.highlights).toHaveLength(3);
      for (const bullet of service.highlights) expect(bullet.trim().length).toBeGreaterThan(10);
    }
  });

  it('retains backwards-compatible anchor aliases on upgraded section IDs', () => {
    const coa = SERVICES_COPY.en.services.find((item) => item.id === 'coa-support');
    const emergency = SERVICES_COPY.en.services.find((item) => item.id === 'emergency-delivery');
    const bulk = SERVICES_COPY.en.services.find((item) => item.id === 'bulk-order');
    expect(coa?.aliasId).toBe('compliance');
    expect(emergency?.aliasId).toBe('delivery');
    expect(bulk?.aliasId).toBe('bulk');
  });
});
