import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import RulePatternInput, { patternForRuleCreation } from './RulePatternInput';

describe('RulePatternInput', () => {
  it('offers literal text as an alternative to regular expressions', () => {
    const onChange = vi.fn();
    const onModeChange = vi.fn();
    const props = {
      value: '',
      onChange,
      onModeChange,
    };
    const { rerender } = render(
      <RulePatternInput
        mode="regex"
        {...props}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'ابحث عن عبارة نصية' }));
    expect(onModeChange).toHaveBeenCalledWith('literal');
    rerender(<RulePatternInput mode="literal" {...props} />);

    fireEvent.change(screen.getByRole('textbox', { name: 'العبارة التي تريد رصدها' }), {
      target: { value: 'price + tax' },
    });
    expect(onChange).toHaveBeenCalledWith('price + tax');
    expect(screen.getByTestId('help-rule-pattern'))
      .toHaveTextContent('دون تفسيرها كنمط');
  });

  it('escapes literal text before saving while preserving explicit regex input', () => {
    const literalPattern = patternForRuleCreation('price + tax (USD)', 'literal');
    expect(literalPattern).toBe('price \\+ tax \\(USD\\)');
    expect(new RegExp(literalPattern, 'i').test('PRICE + TAX (USD)')).toBe(true);
    expect(new RegExp(literalPattern, 'i').test('PRICE xxx TAX (USD)')).toBe(false);
    expect(patternForRuleCreation('console\\.log', 'regex')).toBe('console\\.log');
    expect(patternForRuleCreation('', 'literal')).toBe('');
  });
});
