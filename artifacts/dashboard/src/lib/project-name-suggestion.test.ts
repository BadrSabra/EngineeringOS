import { describe, expect, it } from 'vitest';
import { suggestProjectNameFromGoal } from './project-name-suggestion';

describe('suggestProjectNameFromGoal', () => {
  it('uses the first sentence and removes a common request opener', () => {
    expect(suggestProjectNameFromGoal('أريد إنشاء لوحة متابعة للعملاء. أضف تقارير شهرية.'))
      .toBe('إنشاء لوحة متابعة للعملاء');
  });

  it('keeps the suggestion within the project name limit at a word boundary', () => {
    const suggestion = suggestProjectNameFromGoal(
      `أريد ${'متابعة '.repeat(20)}طلبات العملاء`,
    );

    expect(suggestion.length).toBeLessThanOrEqual(80);
    expect(suggestion).not.toMatch(/\s$/u);
    expect(suggestion).not.toMatch(/متابع$/u);
  });

  it('returns an empty suggestion when the goal contains no usable title', () => {
    expect(suggestProjectNameFromGoal('   ')).toBe('');
    expect(suggestProjectNameFromGoal('أريد.')).toBe('');
  });
});
