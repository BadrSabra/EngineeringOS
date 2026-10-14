const PROJECT_STATUS_LABELS: Record<string, string> = {
  active: "نشط",
  scanning: "جارٍ الفحص",
  archived: "مؤرشف",
};

export function projectStatusLabel(status: string): string {
  return PROJECT_STATUS_LABELS[status] ?? status;
}

export function formatProjectTimestamp(value: string | null | undefined): string {
  if (!value) return "لم يُجرَ بعد";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "تاريخ غير متاح";
  return date.toLocaleString("ar-EG");
}
