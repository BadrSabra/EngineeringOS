import { getResultDetails, type ResultDetailsInput } from './result-details';

const toneClass: Record<string, string> = {
  neutral: 'border-border/50 bg-background/25',
  working: 'border-sky-500/30 bg-sky-500/5',
  attention: 'border-amber-500/35 bg-amber-500/5',
  stopped: 'border-slate-500/35 bg-slate-500/5',
};

/** Display-only explanation. Never an action or acceptance source. */
export function ResultDetailsSummary({ input, testIdSuffix }: { input: ResultDetailsInput; testIdSuffix?: string }) {
  const details = getResultDetails(input);
  const suffix = testIdSuffix ? `-${testIdSuffix}` : '';
  const rows: Array<[string, string, string]> = [
    ['أساس العرض', details.basis, 'basis'],
    ['التحقق', details.verification, 'verification'],
    ['الفحوص', details.checks, 'checks'],
    ['النطاق', details.scope, 'scope'],
  ];
  return (
    <section
      dir="rtl"
      lang="ar"
      className={`mt-3 rounded-md border px-3 py-2.5 text-right text-[11px] leading-5 ${toneClass[details.tone] ?? toneClass.neutral}`}
      aria-label="تفاصيل النتيجة والتحقق"
      data-testid={`result-details${suffix}`}
      data-tone={details.tone}
    >
      <div className="flex flex-wrap items-baseline gap-2">
        <h3 className="text-xs font-semibold text-foreground" data-testid={`text-result-title${suffix}`}>{details.title}</h3>
        {details.attempt !== null && (
          <span className="rounded-full border border-border/50 px-2 py-0.5 text-[10px] text-muted-foreground" data-testid={`text-result-attempt${suffix}`}>
            المحاولة {details.attempt}
          </span>
        )}
      </div>
      <p className="mt-1 text-muted-foreground" data-testid={`text-result-explanation${suffix}`}>{details.explanation}</p>
      <dl className="mt-2 space-y-1.5 border-t border-border/30 pt-2">
        {rows.map(([label, text, key]) => (
          <div key={key} className="grid gap-0.5 sm:grid-cols-[6rem_1fr] sm:gap-2">
            <dt className="font-semibold text-foreground/80">{label}</dt>
            <dd className="text-muted-foreground" data-testid={`text-result-${key}${suffix}`}>{text}</dd>
          </div>
        ))}
      </dl>
      <p className="mt-2 text-[10px] text-muted-foreground/80">
        هذا شرح للعرض فقط، وليس قرار قبول. قد تتضمن أقسام التفاصيل الأخرى فحوصًا مسماة.
      </p>
    </section>
  );
}

export default ResultDetailsSummary;
