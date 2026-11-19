import { describe, expect, it } from 'vitest';
import { matchesProjectSearch, type ProjectSearchRecord } from './project-search';

const project: ProjectSearchRecord = {
  name: 'مركز العملاء',
  description: 'لوحة إدارة لمتجر إلكتروني',
  language: 'TypeScript',
  framework: 'React',
};

describe('matchesProjectSearch', () => {
  it('returns every project for an empty or punctuation-only query', () => {
    expect(matchesProjectSearch(project, '   ')).toBe(true);
    expect(matchesProjectSearch(project, '---')).toBe(true);
  });

  it('matches all words regardless of their order or which field contains them', () => {
    expect(matchesProjectSearch(project, 'React متجر')).toBe(true);
    expect(matchesProjectSearch(project, 'متجر مركز')).toBe(true);
    expect(matchesProjectSearch(project, 'مركز React')).toBe(true);
  });

  it('normalizes Arabic diacritics, alef forms, and the definite article', () => {
    expect(matchesProjectSearch(project, 'الإِدارَة العُمَلاء')).toBe(true);
    expect(matchesProjectSearch(project, 'ادارة عملاء')).toBe(true);
  });

  it('keeps partial word search while requiring every query term', () => {
    expect(matchesProjectSearch(project, 'TypeScr')).toBe(true);
    expect(matchesProjectSearch(project, 'React missing-word')).toBe(false);
  });

  it('does not match terms that only occur across separate projects', () => {
    expect(matchesProjectSearch({ name: 'متجر إلكتروني' }, 'متجر تقرير')).toBe(false);
  });
});
