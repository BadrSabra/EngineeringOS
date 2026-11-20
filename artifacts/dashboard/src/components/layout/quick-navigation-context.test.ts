import { describe, expect, it } from 'vitest';
import {
  addProjectContextToHref,
  getExplicitProjectId,
  isProjectScopedNavigationHref,
} from './quick-navigation-context';

describe('quick navigation project context', () => {
  it('reads an explicit project from project routes and scoped pages only', () => {
    expect(getExplicitProjectId('/projects/project%2Falpha/workspace', '')).toBe('project/alpha');
    expect(getExplicitProjectId('/tasks', '?projectId=project-2')).toBe('project-2');
    expect(getExplicitProjectId('/general-chat', '?projectId=stale-project')).toBeNull();
    expect(getExplicitProjectId('/tasks', '')).toBeNull();
  });

  it('adds project context only to pages that support project-scoped query links', () => {
    expect(isProjectScopedNavigationHref('/tasks')).toBe(true);
    expect(isProjectScopedNavigationHref('/projects')).toBe(false);
    expect(addProjectContextToHref('/events', 'project-1')).toBe('/events?projectId=project-1');
    expect(addProjectContextToHref('/metrics?range=7d', 'project-1'))
      .toBe('/metrics?range=7d&projectId=project-1');
    expect(addProjectContextToHref('/ai', 'project-1')).toBe('/ai');
    expect(addProjectContextToHref('/tasks', null)).toBe('/tasks');
  });
});
