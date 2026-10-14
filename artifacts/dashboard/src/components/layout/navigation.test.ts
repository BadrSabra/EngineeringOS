import { describe, expect, it } from 'vitest';
import {
  getNavigationPageLabel,
  isNavigationItemActive,
  NAV_GROUPS,
  PRIMARY_NAV_ITEMS,
} from './navigation';

describe('dashboard navigation', () => {
  const allItems = [
    ...PRIMARY_NAV_ITEMS,
    ...NAV_GROUPS.flatMap((group) => group.items),
  ];

  it('preserves every existing destination exactly once', () => {
    const hrefs = allItems.map((item) => item.href);

    expect(hrefs).toEqual([
      '/', '/projects', '/ai', '/general-chat',
      '/tasks', '/missions', '/mission-control', '/workflows', '/flight-deck',
      '/events', '/metrics', '/graph', '/rules', '/skill-registry',
    ]);
    expect(new Set(hrefs).size).toBe(hrefs.length);
    expect(hrefs).toContain('/mission-control');
    expect(hrefs).toContain('/skill-registry');
  });

  it('maps nested project routes to their parent destination', () => {
    expect(getNavigationPageLabel('/projects/abc123')).toBe('المشاريع');
    expect(isNavigationItemActive('/projects/abc123', '/projects')).toBe(true);
    expect(isNavigationItemActive('/projects-old', '/projects')).toBe(false);
  });

  it('does not treat the home page as active for every route', () => {
    expect(isNavigationItemActive('/', '/')).toBe(true);
    expect(isNavigationItemActive('/projects', '/')).toBe(false);
  });

  it('explains advanced groups and uses Arabic labels even for an unknown location', () => {
    for (const item of allItems) expect(item.label).toMatch(/[\u0600-\u06ff]/);
    for (const group of NAV_GROUPS) {
      expect(group.label).toMatch(/^متقدم:/);
      expect(group.description).toMatch(/[\u0600-\u06ff]/);
    }
    expect(getNavigationPageLabel('/unknown')).toBe('مساحة العمل');
    expect(getNavigationPageLabel('/missions')).toBe('الأهداف');
  });
});