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

    expect(hrefs).toHaveLength(13);
    expect(new Set(hrefs).size).toBe(hrefs.length);
    expect(hrefs).toContain('/mission-control');
    expect(hrefs).toContain('/skill-registry');
  });

  it('maps nested project routes to their parent destination', () => {
    expect(getNavigationPageLabel('/projects/abc123')).toBe('Projects');
    expect(isNavigationItemActive('/projects/abc123', '/projects')).toBe(true);
    expect(isNavigationItemActive('/projects-old', '/projects')).toBe(false);
  });

  it('does not treat the home page as active for every route', () => {
    expect(isNavigationItemActive('/', '/')).toBe(true);
    expect(isNavigationItemActive('/projects', '/')).toBe(false);
  });
});