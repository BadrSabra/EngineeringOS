const DISCOVERY_RISK_LABELS: Record<string, string> = {
  "No test framework detected": "لم يُكتشف إطار لاختبار المشروع.",
  "No CI/CD pipeline detected": "لم يُكتشف إعداد للتكامل والنشر المستمرين.",
  "Potential hardcoded environment variables": "قد يحتوي المشروع على بيانات إعداد مكتوبة مباشرة في الملفات.",
  "High dependency count (>100 packages)": "يحتوي المشروع على عدد كبير من الحزم التابعة (أكثر من 100).",
};

const SUPPORT_DETAIL_LABELS: Record<string, string> = {
  "TypeScript compiler API": "محلّل TypeScript المعتمد على واجهة المترجم.",
  "TypeScript compiler API in JavaScript mode": "محلّل TypeScript بوضع JavaScript.",
  "Python ast subprocess": "محلّل Python المدمج لبنية الشيفرة.",
  "Go standard-library parser is registered": "محلّل Go القياسي مسجّل.",
  "Go standard-library go/parser": "محلّل Go القياسي.",
  "File inventory only": "جرد أسماء الملفات فقط.",
  "File inventory; no Rust AST extractor registered": "جرد الملفات فقط؛ لا يوجد محلّل بنية Rust مسجّل.",
  "File inventory; no Java AST extractor registered": "جرد الملفات فقط؛ لا يوجد محلّل بنية Java مسجّل.",
  "File-level only": "العلاقات على مستوى الملفات فقط.",
  "AST entities and source relationships": "عناصر الشيفرة والعلاقات بينها.",
  "Package, type, function, and internal import relationships": "علاقات الحزم والأنواع والدوال والاستيرادات داخل المشروع.",
  "AST relationships for successfully parsed files": "علاقات بنية الشيفرة للملفات التي اكتمل تحليلها.",
  "Generic registered profiles; no language-specific profile": "تتوفر فحوص عامة مسجّلة، ولا يوجد فحص خاص بهذه اللغة.",
  "Registered go-tests profile": "فحص Go مسجّل.",
  "Registered go-tests profile: go test ./...": "فحص Go مسجّل: go test ./...",
  "No Rust-specific registered profile": "لا يوجد فحص مسجّل خاص بـ Rust.",
  "No Java-specific registered profile": "لا يوجد فحص مسجّل خاص بـ Java.",
  "No Ruby-specific registered profile": "لا يوجد فحص مسجّل خاص بـ Ruby.",
  "No PHP-specific registered profile": "لا يوجد فحص مسجّل خاص بـ PHP.",
  "No C#-specific registered profile": "لا يوجد فحص مسجّل خاص بـ C#.",
  "No C++-specific registered profile": "لا يوجد فحص مسجّل خاص بـ C++.",
  "No C-specific registered profile": "لا يوجد فحص مسجّل خاص بـ C.",
  "No shell-specific registered profile": "لا يوجد فحص مسجّل خاص بأوامر shell.",
  "No registered validation profile": "لا يوجد فحص تحقق مسجّل.",
  "No framework-specific registered validation profile": "لا يوجد فحص تحقق مسجّل خاص بإطار العمل.",
  "Source-grounded planning is available": "يمكن إعداد خطة تستند إلى ملفات المشروع.",
  "Source-grounded planning plus bounded Go validation": "يمكن إعداد خطة تستند إلى الملفات، مع فحص Go محدود النطاق.",
  "Source-grounded planning only": "يمكن إعداد خطة تستند إلى الملفات فقط.",
  "Requires a successful bounded Go validation run": "يتطلب فحص Go ناجحًا ومحدود النطاق.",
  "Not proven for Rust-specific changes": "لم تثبت جاهزية التغييرات الخاصة بـ Rust.",
  "Not proven for Java-specific changes": "لم تثبت جاهزية التغييرات الخاصة بـ Java.",
  "Not proven for this language": "لم تثبت جاهزية التغييرات الخاصة بهذه اللغة.",
  "A successful validation run is still required before promotion.": "يلزم نجاح الفحص قبل اعتماد التغييرات.",
  "Framework-specific validation is not inferred from the language alone.": "لا يُستنتج توفر فحوص إطار العمل من اسم اللغة وحده.",
  "Syntax errors or unavailable Python parsing degrade the affected file to regex evidence.": "عند تعذر تحليل Python، يقتصر الدليل في الملف المتأثر على مطابقة النصوص.",
  "Discovery keeps Go partial until parser completion and validation registration are both available.": "يبقى دعم Go جزئيًا حتى يكتمل التحليل ويتوفر فحص مسجّل.",
  "Crate, trait, and module relationships are not structurally extracted.": "لا تُستخرج علاقات حزم Rust وسماته ووحداته بنيويًا.",
  "Package, class, and dependency relationships are not structurally extracted.": "لا تُستخرج علاقات الحزم والفئات والاعتماديات بنيويًا.",
  "No Ruby structural parser or registered validation profile is available.": "لا يتوفر محلّل بنية أو فحص مسجّل خاص بـ Ruby.",
  "No PHP structural parser or registered validation profile is available.": "لا يتوفر محلّل بنية أو فحص مسجّل خاص بـ PHP.",
  "No C# structural parser or registered validation profile is available.": "لا يتوفر محلّل بنية أو فحص مسجّل خاص بـ C#.",
  "No C++ structural parser or registered validation profile is available.": "لا يتوفر محلّل بنية أو فحص مسجّل خاص بـ C++.",
  "No C structural parser or registered validation profile is available.": "لا يتوفر محلّل بنية أو فحص مسجّل خاص بـ C.",
  "Shell content is not executable through model-supplied commands.": "لا تُنفّذ أوامر shell التي يقترحها النموذج.",
  "This language is detected but has no registered structural parser or validation profile.": "اكتُشفت هذه اللغة، لكن لا يتوفر لها محلّل بنية أو فحص تحقق مسجّل.",
  "Uses the detected project-language parser": "يستخدم محلّل لغة المشروع المكتشفة.",
  "No framework-specific graph extractor": "لا يوجد محلّل يبني خريطة خاصة بإطار العمل.",
  "No framework-specific build, test, and runtime checks are registered.": "لم تُسجّل فحوص بناء أو اختبار أو تشغيل خاصة بإطار العمل.",
  "Framework support currently means dependency/configuration detection.": "يقتصر دعم إطار العمل حاليًا على اكتشاف الحزم وملفات الإعداد.",
};

export function discoveryRiskLabel(value: string): string {
  return DISCOVERY_RISK_LABELS[value] ?? value;
}

export function supportDetailLabel(value: string): string {
  return SUPPORT_DETAIL_LABELS[value] ?? value;
}

export function discoveryViolationSummary(severity: string, count: number): string {
  const severityLabels: Record<string, string> = {
    critical: "حرجة",
    high: "مرتفعة",
    medium: "متوسطة",
    low: "منخفضة",
    info: "معلوماتية",
  };
  const label = severityLabels[severity.toLowerCase()] ?? "غير محددة";
  return `مخالفة ${label} — عدد المواضع: ${count}`;
}

export function relatedFilesCountLabel(count: number): string {
  return count === 1 ? "ملف واحد متأثر" : `${count} ملفات متأثرة`;
}
