import { describe, expect, it } from "vitest";
import { describePreviewAgentHeartbeatAge } from "./preview-agent-heartbeat-presentation";

describe("describePreviewAgentHeartbeatAge", () => {
  const now = Date.parse("2026-11-19T12:00:00.000Z");

  it("does not manufacture a heartbeat when none was recorded", () => {
    expect(describePreviewAgentHeartbeatAge(null, now)).toBe("لم تُسجل نبضة بعد");
    expect(describePreviewAgentHeartbeatAge(undefined, now)).toBe("لم تُسجل نبضة بعد");
  });

  it("describes a heartbeat younger than one minute without calling the agent online", () => {
    expect(describePreviewAgentHeartbeatAge("2026-11-19T11:59:30.000Z", now))
      .toBe("منذ أقل من دقيقة");
  });

  it("uses Arabic relative time for minute, hour, and day ranges", () => {
    expect(describePreviewAgentHeartbeatAge("2026-11-19T11:58:00.000Z", now))
      .toBe("قبل دقيقتين");
    expect(describePreviewAgentHeartbeatAge("2026-11-19T09:00:00.000Z", now))
      .toBe("قبل 3 ساعات");
    expect(describePreviewAgentHeartbeatAge("2026-11-17T12:00:00.000Z", now))
      .toBe("قبل يومين");
  });

  it("reports malformed timestamps and clock skew explicitly", () => {
    expect(describePreviewAgentHeartbeatAge("not-a-date", now))
      .toBe("وقت النبضة غير صالح؛ لا يمكن تحديد عمرها");
    expect(describePreviewAgentHeartbeatAge("2026-11-19T12:01:00.000Z", now))
      .toBe("وقت النبضة في المستقبل بالنسبة لساعة العرض");
  });

  it("rejects an invalid clock instead of producing a misleading age", () => {
    expect(describePreviewAgentHeartbeatAge("2026-11-19T11:00:00.000Z", Number.NaN))
      .toBe("تعذر حساب عمر النبضة");
  });
});
