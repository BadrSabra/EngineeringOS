# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: dashboard.journey.ts >> EngineeringOS dashboard browser journey >> preserves one partial answer after a provider disconnect and marks it incomplete
- Location: e2e/dashboard.journey.ts:2683:3

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
  2596 |     await page.goto(`${DASHBOARD_PATH}ai`);
  2597 | 
  2598 |     const composer = page.locator("textarea").first();
  2599 |     await composer.fill(fixture.question);
  2600 |     await composer.locator("xpath=..").getByRole("button").click();
  2601 | 
  2602 |     await expect(
  2603 |       page.getByText(fixture.answer, { exact: true }).last(),
  2604 |     ).toBeVisible();
  2605 |     await expect(
  2606 |       page
  2607 |         .getByText("required tool did not complete — BLOCKED/INCOMPLETE", {
  2608 |           exact: false,
  2609 |         })
  2610 |         .last(),
  2611 |     ).toBeVisible();
  2612 |     await page
  2613 |       .locator("summary")
  2614 |       .filter({ hasText: "Agent activity" })
  2615 |       .last()
  2616 |       .click();
  2617 |     await expect(page.locator("body")).toContainText("Reading source");
  2618 |     await expect(page.locator("body")).toContainText(
  2619 |       "src/missing-release-fixture.ts",
  2620 |     );
  2621 |     await expect(page.locator("body")).toContainText("Tool failed");
  2622 |     await expect(page.locator("body")).toContainText("TOOL_EXECUTION_FAILED");
  2623 |     await page
  2624 |       .locator("summary")
  2625 |       .filter({ hasText: "Persisted execution proof" })
  2626 |       .last()
  2627 |       .click();
  2628 |     await expect(
  2629 |       page
  2630 |         .getByText("required tool failed — operation blocked", { exact: true })
  2631 |         .last(),
  2632 |     ).toBeVisible();
  2633 | 
  2634 |     const visibleText = await page.locator("body").innerText();
  2635 |     expect(visibleText).not.toMatch(
  2636 |       /raw exception|stack trace|\/home\/runner|secret|fixture diagnostic/i,
  2637 |     );
  2638 | 
  2639 |     await page.reload();
  2640 |     await page
  2641 |       .getByRole("button", { name: fixture.question, exact: true })
  2642 |       .click();
  2643 | 
  2644 |     await expect(
  2645 |       page.getByText(fixture.answer, { exact: true }).last(),
  2646 |     ).toBeVisible();
  2647 |     await expect(
  2648 |       page
  2649 |         .getByText("required tool did not complete — BLOCKED/INCOMPLETE", {
  2650 |           exact: false,
  2651 |         })
  2652 |         .last(),
  2653 |     ).toBeVisible();
  2654 |     await page
  2655 |       .locator("summary")
  2656 |       .filter({ hasText: "Agent activity" })
  2657 |       .last()
  2658 |       .click();
  2659 |     await expect(page.locator("body")).toContainText("Reading source");
  2660 |     await expect(page.locator("body")).toContainText(
  2661 |       "src/missing-release-fixture.ts",
  2662 |     );
  2663 |     await expect(page.locator("body")).toContainText("Tool failed");
  2664 |     await expect(page.locator("body")).toContainText("TOOL_EXECUTION_FAILED");
  2665 |     await page
  2666 |       .locator("summary")
  2667 |       .filter({ hasText: "Persisted execution proof" })
  2668 |       .last()
  2669 |       .click();
  2670 |     await expect(
  2671 |       page
  2672 |         .getByText("required tool failed — operation blocked", { exact: true })
  2673 |         .last(),
  2674 |     ).toBeVisible();
  2675 | 
  2676 |     const reloadedText = await page.locator("body").innerText();
  2677 |     await expectNoHorizontalOverflow(page);
  2678 |     expect(reloadedText).not.toMatch(
  2679 |       /raw exception|stack trace|\/home\/runner|secret|fixture diagnostic/i,
  2680 |     );
  2681 |   });
  2682 | 
  2683 |   test("preserves one partial answer after a provider disconnect and marks it incomplete", async ({
  2684 |     page,
  2685 |   }) => {
  2686 |     const fixture = await installArabicAiFixture(page);
  2687 |     await installApiFixtures(page, { arabicAi: fixture });
  2688 |     await programmaticSignIn(page);
  2689 |     await page.goto(`${DASHBOARD_PATH}ai`);
  2690 | 
  2691 |     const composer = page.locator("textarea").first();
  2692 |     await composer.fill(fixture.question);
  2693 |     await composer.locator("xpath=..").getByRole("button").click();
  2694 | 
  2695 |     const answer = page.getByText(fixture.answer, { exact: true });
> 2696 |     await expect(answer).toHaveCount(1);
       |                          ^ Error: expect(locator).toHaveCount(expected) failed
  2697 |     await expect(answer).toBeVisible();
  2698 |     await expect(page.getByText("INCOMPLETE:", { exact: false })).toBeVisible();
  2699 |     await expect(
  2700 |       page.getByText("provider failure", { exact: false }).last(),
  2701 |     ).toBeVisible();
  2702 |     await expect(
  2703 |       page.getByText("stopped: provider timeout", { exact: false }).last(),
  2704 |     ).toBeVisible();
  2705 |     await expect(
  2706 |       page.getByText("The provider disconnected after visible response text.", {
  2707 |         exact: true,
  2708 |       }),
  2709 |     ).toBeVisible();
  2710 | 
  2711 |     await page.reload();
  2712 |     await page
  2713 |       .getByRole("button", { name: fixture.question, exact: true })
  2714 |       .click();
  2715 | 
  2716 |     await expect(page.getByText(fixture.answer, { exact: true })).toHaveCount(
  2717 |       1,
  2718 |     );
  2719 |     await expect(page.getByText(fixture.answer, { exact: true })).toBeVisible();
  2720 |     await expect(page.getByText("INCOMPLETE:", { exact: false })).toBeVisible();
  2721 |     await expect(
  2722 |       page.getByText("provider failure", { exact: false }).last(),
  2723 |     ).toBeVisible();
  2724 |     await expect(
  2725 |       page.getByText("stopped: provider timeout", { exact: false }).last(),
  2726 |     ).toBeVisible();
  2727 |     await expect(
  2728 |       page.getByText("The provider disconnected after visible response text.", {
  2729 |         exact: true,
  2730 |       }),
  2731 |     ).toBeVisible();
  2732 |   });
  2733 | 
  2734 |   test("resumes a failed analysis and keeps the execution incomplete", async ({
  2735 |     page,
  2736 |   }) => {
  2737 |     const { fixture, execution } = installResumedAnalysisFailureFixture();
  2738 |     await installApiFixtures(page, {
  2739 |       arabicAi: fixture,
  2740 |       resumeFailure: { fixture, execution },
  2741 |     });
  2742 |     await programmaticSignIn(page);
  2743 | 
  2744 |     await page.evaluate(
  2745 |       ({ sessionId, executionId, projectId, resumeToken, message }) => {
  2746 |         localStorage.setItem(
  2747 |           `eos_ai_execution_current_${projectId}`,
  2748 |           sessionId,
  2749 |         );
  2750 |         localStorage.setItem(
  2751 |           `eos_ai_execution_${projectId}_${sessionId}`,
  2752 |           JSON.stringify({
  2753 |             id: executionId,
  2754 |             projectId,
  2755 |             sessionId,
  2756 |             resumeToken,
  2757 |             message,
  2758 |           }),
  2759 |         );
  2760 |       },
  2761 |       {
  2762 |         sessionId: fixture.sessionId,
  2763 |         executionId: fixture.executionId,
  2764 |         projectId: "e2e-project",
  2765 |         resumeToken: "e2e-resumed-analysis-failure-token-opaque",
  2766 |         message: fixture.question,
  2767 |       },
  2768 |     );
  2769 |     await page.goto(`${DASHBOARD_PATH}ai`);
  2770 | 
  2771 |     await expect(
  2772 |       page.getByText("A saved AI execution is ready to resume"),
  2773 |     ).toBeVisible();
  2774 |     const resumeRequest = page.waitForRequest(
  2775 |       (request) =>
  2776 |         request.url().includes("/api/ai/chat/stream") &&
  2777 |         request.method() === "POST",
  2778 |     );
  2779 |     await page.getByRole("button", { name: "Resume", exact: true }).click();
  2780 |     const requestBody = JSON.parse(
  2781 |       (await resumeRequest).postData() ?? "{}",
  2782 |     ) as Record<string, unknown>;
  2783 |     expect(requestBody).toEqual(
  2784 |       expect.objectContaining({
  2785 |         projectId: "e2e-project",
  2786 |         sessionId: fixture.sessionId,
  2787 |         executionId: fixture.executionId,
  2788 |         resumeToken: "e2e-resumed-analysis-failure-token-opaque",
  2789 |         message: fixture.question,
  2790 |       }),
  2791 |     );
  2792 | 
  2793 |     await expect(
  2794 |       page.getByText("Failed to send message", { exact: true }),
  2795 |     ).toBeVisible();
  2796 |     await expect(
```