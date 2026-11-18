import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import ProjectCanvasPanel from "./ProjectCanvasPanel";

describe("ProjectCanvasPanel", () => {
  it("does not infer candidate or runtime availability when their sources are unavailable", () => {
    render(
      <ProjectCanvasPanel
        candidateSourceAvailable={false}
        hasCandidate={false}
        runtimeSourceAvailable={false}
        runtimeStatusLabel="غير متاح"
      />,
    );

    expect(screen.getByTestId("workspace-preview-gate")).toHaveTextContent(
      "لا توجد معاينة تفاعلية مؤهلة بعد",
    );
    expect(screen.getByText("مصدر المرشح غير متاح الآن؛ لا يمكن تأكيد وجود نسخة مرشحة.")).toBeInTheDocument();
    expect(screen.getByText("غير متاحة؛ لا يمكن تأكيد حالة التشغيل")).toBeInTheDocument();
  });

  it("keeps registered candidate and Runtime status separate from Preview qualification", () => {
    render(
      <ProjectCanvasPanel
        candidateSourceAvailable
        hasCandidate
        runtimeSourceAvailable
        runtimeStatusLabel="قيد التشغيل"
      />,
    );

    expect(screen.getByText("يوجد مرشح مسجل. تسجيل المرشح وحده لا يؤهله للمعاينة التفاعلية.")).toBeInTheDocument();
    expect(screen.getByText("قيد التشغيل — ليست إثباتًا على جاهزية Preview")).toBeInTheDocument();
    expect(screen.getByText("غير متاحة حالياً")).toBeInTheDocument();
  });
});
