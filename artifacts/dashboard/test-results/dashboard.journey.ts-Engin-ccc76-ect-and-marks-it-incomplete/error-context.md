# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: dashboard.journey.ts >> EngineeringOS dashboard browser journey >> preserves one partial answer after a provider disconnect and marks it incomplete
- Location: e2e/dashboard.journey.ts:2707:3

# Error details

```
Error: expect(locator).toHaveCount(expected) failed

Locator:  getByText('عند انتهاء مهلة مزود الذكاء الاصطناعي، يعيد المسار تقريرًا جزئيًا من الأدلة التي جُمعت بدل إصدار Finding غير مثبت.', { exact: true })
Expected: 1
Received: 2
Timeout:  10000ms

Call log:
  - Expect "toHaveCount" with timeout 10000ms
  - waiting for getByText('عند انتهاء مهلة مزود الذكاء الاصطناعي، يعيد المسار تقريرًا جزئيًا من الأدلة التي جُمعت بدل إصدار Finding غير مثبت.', { exact: true })
    24 × locator resolved to 2 elements
       - unexpected value "2"

```

# Page snapshot

```yaml
- generic [ref=f2e2]:
  - generic [ref=f2e3]:
    - generic [ref=f2e4]:
      - generic [ref=f2e5]: EngineeringOS
      - generic [ref=f2e13]:
        - generic [ref=f2e14]: Core Ops
        - link "Dashboard" [ref=f2e15] [cursor=pointer]:
          - /url: /dashboard/
        - link "Projects" [ref=f2e21] [cursor=pointer]:
          - /url: /dashboard/projects
        - link "Tasks" [ref=f2e27] [cursor=pointer]:
          - /url: /dashboard/tasks
        - link "Rules Engine" [ref=f2e31] [cursor=pointer]:
          - /url: /dashboard/rules
        - link "Workflows" [ref=f2e34] [cursor=pointer]:
          - /url: /dashboard/workflows
        - link "Event Stream" [ref=f2e39] [cursor=pointer]:
          - /url: /dashboard/events
        - link "Metrics" [ref=f2e42] [cursor=pointer]:
          - /url: /dashboard/metrics
        - link "Knowledge Graph" [ref=f2e45] [cursor=pointer]:
          - /url: /dashboard/graph
        - link "AI Assistant" [ref=f2e51] [cursor=pointer]:
          - /url: /dashboard/ai
        - link "Flight Deck" [ref=f2e55] [cursor=pointer]:
          - /url: /dashboard/flight-deck
        - link "Mission Control" [ref=f2e58] [cursor=pointer]:
          - /url: /dashboard/mission-control
      - generic [ref=f2e63]:
        - generic [ref=f2e64]: ED
        - generic [ref=f2e65]:
          - generic [ref=f2e66]: EngineeringOS Dashboard Smoke
          - generic [ref=f2e67]: Connected
        - button "Sign out" [ref=f2e69]
    - generic [ref=f2e73]:
      - banner [ref=f2e74]:
        - textbox "Search projects, tasks, rules... (Press '/')" [ref=f2e79]
        - generic [ref=f2e80]:
          - generic [ref=f2e81]: v1.0.4-stable
          - button [ref=f2e86]
      - main [ref=f2e91]:
        - generic [ref=f2e93]:
          - generic [ref=f2e94]:
            - generic [ref=f2e95]:
              - generic [ref=f2e96]: Sessions
              - button "New session" [ref=f2e98]
            - combobox [ref=f2e101]:
              - option "Smoke Project" [selected]
            - button "ماذا يحدث عند انتهاء مهلة provider timeout داخل execution-tools.ts؟" [ref=f2e106]
            - generic [ref=f2e109]:
              - generic [ref=f2e110]:
                - generic [ref=f2e111]:
                  - generic [ref=f2e116]: OpenRouter API Key
                  - generic [ref=f2e117]: Priority
                - paragraph [ref=f2e118]: Get a free key at openrouter.ai/keys — routes to 300+ models, used first when configured.
                - generic [ref=f2e119]:
                  - textbox "sk-or-…" [ref=f2e120]
                  - button "Save" [disabled]
              - generic [ref=f2e121]:
                - generic [ref=f2e122]:
                  - generic [ref=f2e127]: Gemini API Key
                  - generic [ref=f2e128]: Free · Priority
                - paragraph [ref=f2e129]: Free key at aistudio.google.com/apikey — 1,500 req/day, 1M tokens/day.
                - generic [ref=f2e130]:
                  - textbox "AIza…" [ref=f2e131]
                  - button "Save" [ref=f2e132]
              - generic [ref=f2e133]:
                - generic [ref=f2e134]:
                  - generic [ref=f2e139]: DeepSeek API Key
                  - generic [ref=f2e140]: Optional
                - paragraph [ref=f2e141]: Get a free API key at platform.deepseek.com to use DeepSeek as your AI provider.
                - generic [ref=f2e142]:
                  - textbox "sk-…" [ref=f2e143]
                  - button "Save" [disabled]
              - generic [ref=f2e144]:
                - generic [ref=f2e145]: Groq API Key
                - paragraph [ref=f2e151]: No personal key saved — the server's key will be used if one is configured.
                - generic [ref=f2e152]:
                  - textbox "gsk_…" [ref=f2e153]
                  - button "Save" [disabled]
          - generic [ref=f2e154]:
            - generic [ref=f2e155]:
              - generic [ref=f2e159]: EngineeringOS AI
              - generic [ref=f2e160]: Llama 3.3 · Groq
            - generic [ref=f2e164]:
              - generic [ref=f2e165]: ماذا يحدث عند انتهاء مهلة provider timeout داخل execution-tools.ts؟
              - generic [ref=f2e177]:
                - generic [ref=f2e178]:
                  - paragraph [ref=f2e179]: عند انتهاء مهلة مزود الذكاء الاصطناعي، يعيد المسار تقريرًا جزئيًا من الأدلة التي جُمعت بدل إصدار Finding غير مثبت.
                  - heading "6) Final Judgment" [level=2] [ref=f2e180]
                  - paragraph [ref=f2e181]: NOT PROVEN
                - generic [ref=f2e182]:
                  - generic [ref=f2e183]: Behavior evidence · 1 excerpt
                  - generic [ref=f2e192]:
                    - generic [ref=f2e193]: "Accepted: source span verified."
                    - generic [ref=f2e197]: return partialFromCollectedEvidence("provider timeout");
                    - generic [ref=f2e198]:
                      - button "src/execution-tools.ts:42" [ref=f2e199]
                      - button "View file" [ref=f2e207]
                - generic [ref=f2e211]:
                  - generic [ref=f2e212]:
                    - generic [ref=f2e218]: Behavior answer
                    - generic [ref=f2e219]: confidence 100%
                  - paragraph [ref=f2e220]: عند انتهاء مهلة مزود الذكاء الاصطناعي، يعيد المسار تقريرًا جزئيًا من الأدلة التي جُمعت بدل إصدار Finding غير مثبت.
                  - generic [ref=f2e221]: src/execution-tools.ts
                  - generic [ref=f2e223]: "Answered fields: timeout behavior"
                  - generic [ref=f2e224]:
                    - generic [ref=f2e225]: Behavior evidence · 1 excerpt
                    - generic [ref=f2e234]:
                      - generic [ref=f2e235]: "Accepted: source span verified."
                      - generic [ref=f2e239]: return partialFromCollectedEvidence("provider timeout");
                      - generic [ref=f2e240]:
                        - button "src/execution-tools.ts:42" [ref=f2e241]
                        - button "View file" [ref=f2e249]
                - group [ref=f2e253]:
                  - generic "Agent activity · 1 events" [ref=f2e254] [cursor=pointer]:
                    - generic [ref=f2e257]: Agent activity
                    - generic [ref=f2e258]: · 1 events
                - button "Forensic evidence NOT PROVEN" [ref=f2e262]:
                  - generic [ref=f2e265]: Forensic evidence
                  - generic [ref=f2e266]: NOT PROVEN
            - generic [ref=f2e270]:
              - textbox "Ask about your codebase, tasks, or metrics… (Enter to send)" [ref=f2e271]
              - button [disabled]
  - region "Notifications (F8)":
    - list
```

# Test source

```ts
  2620 |     await page.goto(`${DASHBOARD_PATH}ai`);
  2621 | 
  2622 |     const composer = page.locator("textarea").first();
  2623 |     await composer.fill(fixture.question);
  2624 |     await composer.locator("xpath=..").getByRole("button").click();
  2625 | 
  2626 |     await expect(
  2627 |       page.getByText(fixture.answer, { exact: true }).last(),
  2628 |     ).toBeVisible();
  2629 |     await expect(
  2630 |       page
  2631 |         .getByText("required tool did not complete — BLOCKED/INCOMPLETE", {
  2632 |           exact: false,
  2633 |         })
  2634 |         .last(),
  2635 |     ).toBeVisible();
  2636 |     await page
  2637 |       .locator("summary")
  2638 |       .filter({ hasText: "Agent activity" })
  2639 |       .last()
  2640 |       .click();
  2641 |     await expect(page.locator("body")).toContainText("Reading source");
  2642 |     await expect(page.locator("body")).toContainText(
  2643 |       "src/missing-release-fixture.ts",
  2644 |     );
  2645 |     await expect(page.locator("body")).toContainText("Tool failed");
  2646 |     await expect(page.locator("body")).toContainText("TOOL_EXECUTION_FAILED");
  2647 |     await page
  2648 |       .locator("summary")
  2649 |       .filter({ hasText: "Persisted execution proof" })
  2650 |       .last()
  2651 |       .click();
  2652 |     await expect(
  2653 |       page
  2654 |         .getByText("required tool failed — operation blocked", { exact: true })
  2655 |         .last(),
  2656 |     ).toBeVisible();
  2657 | 
  2658 |     const visibleText = await page.locator("body").innerText();
  2659 |     expect(visibleText).not.toMatch(
  2660 |       /raw exception|stack trace|\/home\/runner|secret|fixture diagnostic/i,
  2661 |     );
  2662 | 
  2663 |     await page.reload();
  2664 |     await page
  2665 |       .getByRole("button", { name: fixture.question, exact: true })
  2666 |       .click();
  2667 | 
  2668 |     await expect(
  2669 |       page.getByText(fixture.answer, { exact: true }).last(),
  2670 |     ).toBeVisible();
  2671 |     await expect(
  2672 |       page
  2673 |         .getByText("required tool did not complete — BLOCKED/INCOMPLETE", {
  2674 |           exact: false,
  2675 |         })
  2676 |         .last(),
  2677 |     ).toBeVisible();
  2678 |     await page
  2679 |       .locator("summary")
  2680 |       .filter({ hasText: "Agent activity" })
  2681 |       .last()
  2682 |       .click();
  2683 |     await expect(page.locator("body")).toContainText("Reading source");
  2684 |     await expect(page.locator("body")).toContainText(
  2685 |       "src/missing-release-fixture.ts",
  2686 |     );
  2687 |     await expect(page.locator("body")).toContainText("Tool failed");
  2688 |     await expect(page.locator("body")).toContainText("TOOL_EXECUTION_FAILED");
  2689 |     await page
  2690 |       .locator("summary")
  2691 |       .filter({ hasText: "Persisted execution proof" })
  2692 |       .last()
  2693 |       .click();
  2694 |     await expect(
  2695 |       page
  2696 |         .getByText("required tool failed — operation blocked", { exact: true })
  2697 |         .last(),
  2698 |     ).toBeVisible();
  2699 | 
  2700 |     const reloadedText = await page.locator("body").innerText();
  2701 |     await expectNoHorizontalOverflow(page);
  2702 |     expect(reloadedText).not.toMatch(
  2703 |       /raw exception|stack trace|\/home\/runner|secret|fixture diagnostic/i,
  2704 |     );
  2705 |   });
  2706 | 
  2707 |   test("preserves one partial answer after a provider disconnect and marks it incomplete", async ({
  2708 |     page,
  2709 |   }) => {
  2710 |     const fixture = await installArabicAiFixture(page);
  2711 |     await installApiFixtures(page, { arabicAi: fixture });
  2712 |     await programmaticSignIn(page);
  2713 |     await page.goto(`${DASHBOARD_PATH}ai`);
  2714 | 
  2715 |     const composer = page.locator("textarea").first();
  2716 |     await composer.fill(fixture.question);
  2717 |     await composer.locator("xpath=..").getByRole("button").click();
  2718 | 
  2719 |     const answer = page.getByText(fixture.answer, { exact: true });
> 2720 |     await expect(answer).toHaveCount(1);
       |                          ^ Error: expect(locator).toHaveCount(expected) failed
  2721 |     await expect(answer).toBeVisible();
  2722 |     await expect(page.getByText("INCOMPLETE:", { exact: false })).toBeVisible();
  2723 |     await expect(
  2724 |       page.getByText("provider failure", { exact: false }).last(),
  2725 |     ).toBeVisible();
  2726 |     await expect(
  2727 |       page.getByText("stopped: provider timeout", { exact: false }).last(),
  2728 |     ).toBeVisible();
  2729 |     await expect(
  2730 |       page.getByText("The provider disconnected after visible response text.", {
  2731 |         exact: true,
  2732 |       }),
  2733 |     ).toBeVisible();
  2734 | 
  2735 |     await page.reload();
  2736 |     await page
  2737 |       .getByRole("button", { name: fixture.question, exact: true })
  2738 |       .click();
  2739 | 
  2740 |     await expect(page.getByText(fixture.answer, { exact: true })).toHaveCount(
  2741 |       1,
  2742 |     );
  2743 |     await expect(page.getByText(fixture.answer, { exact: true })).toBeVisible();
  2744 |     await expect(page.getByText("INCOMPLETE:", { exact: false })).toBeVisible();
  2745 |     await expect(
  2746 |       page.getByText("provider failure", { exact: false }).last(),
  2747 |     ).toBeVisible();
  2748 |     await expect(
  2749 |       page.getByText("stopped: provider timeout", { exact: false }).last(),
  2750 |     ).toBeVisible();
  2751 |     await expect(
  2752 |       page.getByText("The provider disconnected after visible response text.", {
  2753 |         exact: true,
  2754 |       }),
  2755 |     ).toBeVisible();
  2756 |   });
  2757 | 
  2758 |   test("resumes a failed analysis and keeps the execution incomplete", async ({
  2759 |     page,
  2760 |   }) => {
  2761 |     const { fixture, execution } = installResumedAnalysisFailureFixture();
  2762 |     await installApiFixtures(page, {
  2763 |       arabicAi: fixture,
  2764 |       resumeFailure: { fixture, execution },
  2765 |     });
  2766 |     await programmaticSignIn(page);
  2767 | 
  2768 |     await page.evaluate(
  2769 |       ({ sessionId, executionId, projectId, resumeToken, message }) => {
  2770 |         localStorage.setItem(
  2771 |           `eos_ai_execution_current_${projectId}`,
  2772 |           sessionId,
  2773 |         );
  2774 |         localStorage.setItem(
  2775 |           `eos_ai_execution_${projectId}_${sessionId}`,
  2776 |           JSON.stringify({
  2777 |             id: executionId,
  2778 |             projectId,
  2779 |             sessionId,
  2780 |             resumeToken,
  2781 |             message,
  2782 |           }),
  2783 |         );
  2784 |       },
  2785 |       {
  2786 |         sessionId: fixture.sessionId,
  2787 |         executionId: fixture.executionId,
  2788 |         projectId: "e2e-project",
  2789 |         resumeToken: "e2e-resumed-analysis-failure-token-opaque",
  2790 |         message: fixture.question,
  2791 |       },
  2792 |     );
  2793 |     await page.goto(`${DASHBOARD_PATH}ai`);
  2794 | 
  2795 |     await expect(
  2796 |       page.getByText("A saved AI execution is ready to resume"),
  2797 |     ).toBeVisible();
  2798 |     const resumeRequest = page.waitForRequest(
  2799 |       (request) =>
  2800 |         request.url().includes("/api/ai/chat/stream") &&
  2801 |         request.method() === "POST",
  2802 |     );
  2803 |     await page.getByRole("button", { name: "Resume", exact: true }).click();
  2804 |     const requestBody = JSON.parse(
  2805 |       (await resumeRequest).postData() ?? "{}",
  2806 |     ) as Record<string, unknown>;
  2807 |     expect(requestBody).toEqual(
  2808 |       expect.objectContaining({
  2809 |         projectId: "e2e-project",
  2810 |         sessionId: fixture.sessionId,
  2811 |         executionId: fixture.executionId,
  2812 |         resumeToken: "e2e-resumed-analysis-failure-token-opaque",
  2813 |         message: fixture.question,
  2814 |       }),
  2815 |     );
  2816 | 
  2817 |     await expect(
  2818 |       page.getByText("Failed to send message", { exact: true }),
  2819 |     ).toBeVisible();
  2820 |     await expect(
```