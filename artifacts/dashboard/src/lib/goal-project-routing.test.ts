import { describe, expect, it } from 'vitest';
import { matchGoalToProject } from './goal-project-routing';

describe('matchGoalToProject', () => {
  const projects = [
    { id: 'customers', name: 'بوابة العملاء' },
    { id: 'admin', name: 'لوحة الإدارة' },
  ];

  it('suggests a project only when its full name appears as a phrase', () => {
    expect(matchGoalToProject('راجع أداء مشروع بوابة العملاء من فضلك', projects)).toEqual({
      kind: 'unique',
      project: projects[0],
    });
  });

  it('normalizes Arabic alef variants, diacritics, and punctuation for matching', () => {
    expect(matchGoalToProject('افحص بوابةُ العُملاء!', projects)).toEqual({
      kind: 'unique',
      project: projects[0],
    });
  });

  it('does not infer a project merely because only one project exists', () => {
    expect(matchGoalToProject('ساعدني على فهم التخزين المؤقت', [projects[0]])).toEqual({
      kind: 'none',
    });
  });

  it('does not match a project name inside a larger word', () => {
    expect(matchGoalToProject('راجع بوابة العملاءية', [projects[0]])).toEqual({
      kind: 'none',
    });
  });

  it('treats multiple project-name matches as ambiguous', () => {
    expect(matchGoalToProject('قارن بوابة العملاء مع لوحة الإدارة', projects)).toEqual({
      kind: 'ambiguous',
    });
  });

  it('treats duplicate normalized project names as ambiguous', () => {
    expect(matchGoalToProject('راجع بوابة العملاء', [
      projects[0],
      { id: 'customers-copy', name: 'بوابةُ العملاء' },
    ])).toEqual({ kind: 'ambiguous' });
  });
});
