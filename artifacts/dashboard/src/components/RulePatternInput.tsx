import { useId } from 'react';

export type RulePatternMode = 'regex' | 'literal';

export function patternForRuleCreation(value: string, mode: RulePatternMode): string {
  if (mode === 'regex') return value;
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export default function RulePatternInput({
  value,
  mode,
  onChange,
  onModeChange,
}: {
  value: string;
  mode: RulePatternMode;
  onChange: (value: string) => void;
  onModeChange: (mode: RulePatternMode) => void;
}) {
  const inputId = useId();

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <label htmlFor={inputId} className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
          {mode === 'literal' ? 'العبارة التي تريد رصدها' : 'النمط (Regex)'}
        </label>
        <button
          type="button"
          aria-pressed={mode === 'literal'}
          data-testid="button-toggle-rule-pattern-mode"
          onClick={() => onModeChange(mode === 'literal' ? 'regex' : 'literal')}
          className="text-xs text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded"
        >
          {mode === 'literal' ? 'استخدم Regex' : 'ابحث عن عبارة نصية'}
        </button>
      </div>
      <input
        id={inputId}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className={`w-full bg-secondary border border-border rounded-md px-3 py-2 text-sm focus:border-primary focus:outline-none ${
          mode === 'regex' ? 'font-mono' : ''
        }`}
        placeholder={mode === 'literal' ? 'مثال: console.log' : 'مثال: console\\.log'}
        dir={mode === 'literal' ? 'auto' : 'ltr'}
        data-testid="input-rule-pattern"
      />
      <p data-testid="help-rule-pattern" className="text-xs text-muted-foreground">
        {mode === 'literal'
          ? 'سيبحث الفحص عن العبارة كما كتبتها، حتى الرموز مثل + و*، دون تفسيرها كنمط.'
          : 'استخدم Regex إذا كنت تريد البحث بنمط تقني. يمكنك التحويل إلى بحث عن عبارة عادية.'}
      </p>
    </div>
  );
}
