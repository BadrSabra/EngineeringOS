const ENTITY_TYPE_LABELS: Record<string, string> = {
  file: 'ملف',
  function: 'دالة',
  class: 'فئة',
  api: 'نقطة API',
  task: 'مهمة',
  rule: 'قاعدة فحص',
  phase: 'مرحلة',
  module: 'وحدة برمجية',
};

const RELATION_LABELS: Record<string, string> = {
  imports: 'استيراد',
  calls: 'استدعاء',
  extends: 'وراثة',
  implements: 'تطبيق',
  uses: 'استخدام',
  emits: 'إصدار حدث',
  observes: 'مراقبة',
  produces: 'إنتاج',
  depends_on: 'اعتماد',
};

export function graphEntityTypeLabel(type: string): string {
  return ENTITY_TYPE_LABELS[type] ?? type;
}

export function graphRelationLabel(relation: string): string {
  return RELATION_LABELS[relation] ?? relation;
}
