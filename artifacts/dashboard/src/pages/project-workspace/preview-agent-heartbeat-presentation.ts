export function describePreviewAgentHeartbeatAge(
  lastSeenAt: string | null | undefined,
  now = Date.now(),
): string {
  if (!lastSeenAt) return "لم تُسجل نبضة بعد";

  const heartbeatAt = Date.parse(lastSeenAt);
  if (!Number.isFinite(heartbeatAt)) {
    return "وقت النبضة غير صالح؛ لا يمكن تحديد عمرها";
  }
  if (!Number.isFinite(now)) {
    return "تعذر حساب عمر النبضة";
  }

  const elapsedMs = now - heartbeatAt;
  if (elapsedMs < 0) {
    return "وقت النبضة في المستقبل بالنسبة لساعة العرض";
  }
  if (elapsedMs < 60_000) {
    return "منذ أقل من دقيقة";
  }

  const relativeTime = new Intl.RelativeTimeFormat("ar", { numeric: "always" });
  const minutes = Math.floor(elapsedMs / 60_000);
  if (minutes < 60) return relativeTime.format(-minutes, "minute");

  const hours = Math.floor(elapsedMs / 3_600_000);
  if (hours < 24) return relativeTime.format(-hours, "hour");

  const days = Math.floor(elapsedMs / 86_400_000);
  return relativeTime.format(-days, "day");
}
