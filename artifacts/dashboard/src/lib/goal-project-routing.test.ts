import { describe, expect, it } from 'vitest';
import { matchGoalToProject, suggestGoalProjects } from './goal-project-routing';

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

  it('does not auto-route when an exact match competes with a partial name match', () => {
    const goal = 'قارن بوابة العملاء مع لوحة إدارة';
    expect(matchGoalToProject(goal, projects)).toEqual({ kind: 'ambiguous' });
    expect(suggestGoalProjects(goal, projects)).toEqual([
      { project: projects[0], kind: 'exact', matchedTerms: [] },
      {
        project: projects[1],
        kind: 'partial',
        matchedTerms: ['لوحة', 'ادارة'],
      },
    ]);
  });

  it('treats duplicate normalized project names as ambiguous', () => {
    expect(matchGoalToProject('راجع بوابة العملاء', [
      projects[0],
      { id: 'customers-copy', name: 'بوابةُ العملاء' },
    ])).toEqual({ kind: 'ambiguous' });
  });

  it('suggests all exactly mentioned projects without choosing one', () => {
    expect(suggestGoalProjects('قارن بوابة العملاء مع لوحة الإدارة', projects)).toEqual([
      { project: projects[0], kind: 'exact', matchedTerms: [] },
      { project: projects[1], kind: 'exact', matchedTerms: [] },
    ]);
  });

  it('offers a ranked partial-word suggestion with the reason terms', () => {
    expect(suggestGoalProjects('راجع بوابة العميل', [
      projects[0],
      { id: 'support', name: 'مركز خدمة العملاء' },
    ])).toEqual([
      { project: projects[0], kind: 'partial', matchedTerms: ['بوابة'] },
    ]);
  });

  it('does not suggest projects from generic project words alone', () => {
    expect(suggestGoalProjects('ساعدني في مشروعي مع هذا المشروع', projects)).toEqual([]);
  });

  it('matches a partial term despite the Arabic definite article', () => {
    expect(suggestGoalProjects('راجع لوحة إدارة', [
      { id: 'admin', name: 'لوحة الإدارة' },
      { id: 'customers', name: 'بوابة العملاء' },
    ])).toEqual([
      {
        project: { id: 'admin', name: 'لوحة الإدارة' },
        kind: 'partial',
        matchedTerms: ['لوحة', 'ادارة'],
      },
    ]);
  });

  it('suggests from project description terms without treating them as a route match', () => {
    const projects = [
      {
        id: 'store',
        name: 'متجر زهرة',
        description: 'تسجيل دخول آمن وإدارة حسابات العملاء',
        language: 'TypeScript',
        framework: 'Next.js',
      },
      {
        id: 'analytics',
        name: 'لوحة بيانات',
        description: 'تقارير الأداء ومخططات الاستخدام',
        language: 'Python',
        framework: 'FastAPI',
      },
    ];
    const goal = 'أريد تحسين تسجيل الدخول الآمن وحسابات العملاء';

    expect(matchGoalToProject(goal, projects)).toEqual({ kind: 'none' });
    expect(suggestGoalProjects(goal, projects)).toEqual([
      {
        project: projects[0],
        kind: 'context',
        matchedTerms: ['تسجيل', 'دخول', 'امن', 'عملاء'],
      },
    ]);
  });

  it('accepts an exact technology mention but keeps it advisory', () => {
    const projects = [
      { id: 'store', name: 'متجر زهرة', framework: 'React' },
      { id: 'portal', name: 'بوابة العملاء', framework: 'Vue' },
    ];

    expect(matchGoalToProject('حسّن واجهة React', projects)).toEqual({ kind: 'none' });
    expect(suggestGoalProjects('حسّن واجهة React', projects)).toEqual([
      {
        project: projects[0],
        kind: 'context',
        matchedTerms: ['react'],
      },
    ]);
  });

  it('ignores one weak description overlap and limits contextual suggestions', () => {
    expect(suggestGoalProjects('طوّر نظام', [
      { id: 'one', name: 'متجر ألفا', description: 'نظام للتجارة' },
    ])).toEqual([]);
  });

  it('limits partial suggestions while retaining the strongest matches first', () => {
    expect(suggestGoalProjects('راجع بوابة إدارة العملاء', [
      { id: 'one', name: 'لوحة الإدارة' },
      { id: 'two', name: 'بوابة المتجر' },
      { id: 'three', name: 'بوابة العملاء' },
      { id: 'four', name: 'إدارة النظام' },
    ])).toEqual([
      {
        project: { id: 'three', name: 'بوابة العملاء' },
        kind: 'partial',
        matchedTerms: ['بوابة', 'عملاء'],
      },
      {
        project: { id: 'one', name: 'لوحة الإدارة' },
        kind: 'partial',
        matchedTerms: ['ادارة'],
      },
      {
        project: { id: 'two', name: 'بوابة المتجر' },
        kind: 'partial',
        matchedTerms: ['بوابة'],
      },
    ]);
  });
});
