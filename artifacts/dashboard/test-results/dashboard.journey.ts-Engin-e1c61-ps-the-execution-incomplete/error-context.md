# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: dashboard.journey.ts >> EngineeringOS dashboard browser journey >> resumes a failed analysis and keeps the execution incomplete
- Location: e2e/dashboard.journey.ts:2758:3

# Error details

```
Error: locator.click: Error: strict mode violation: getByRole('button', { name: 'Resume', exact: true }) resolved to 2 elements:
    1) <button type="button" data-component-name="Comp" data-replit-metadata="artifacts/dashboard/src/components/ui/button.tsx:54:6" class="inline-flex items-center justify-center gap-2 whitespace-nowrap font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0 hover-elevate active-elevate-2 border [border-color:var(--button-outline)] shadow-xs active:shadow…>…</button> aka getByLabel('Agent execution proof').getByRole('button', { name: 'Resume' })
    2) <button data-component-name="Comp" data-replit-metadata="artifacts/dashboard/src/components/ui/button.tsx:54:6" class="inline-flex items-center justify-center gap-2 whitespace-nowrap font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0 hover-elevate active-elevate-2 border [border-color:var(--button-outline)] shadow-xs active:shadow-none min-h-8 …>…</button> aka getByRole('button', { name: 'Resume' }).nth(1)

Call log:
  - waiting for getByRole('button', { name: 'Resume', exact: true })

```

```
Error: page.waitForRequest: Test ended.
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
            - button "Verify the analysis evidence after reconnect." [ref=f2e106]
            - generic [ref=f2e109]:
              - generic [ref=f2e110]:
                - generic [ref=f2e111]:
                  - generic [ref=f2e116]: OpenRouter API Key
                  - generic [ref=f2e117]: Priority
                - paragraph [ref=f2e118]: Loading…
                - generic [ref=f2e119]:
                  - textbox "sk-or-…" [ref=f2e120]
                  - button "Save" [disabled]
              - generic [ref=f2e121]:
                - generic [ref=f2e122]:
                  - generic [ref=f2e127]: Gemini API Key
                  - generic [ref=f2e128]: Free · Priority
                - paragraph [ref=f2e129]: Loading…
                - generic [ref=f2e130]:
                  - textbox "AIza…" [ref=f2e131]
                  - button "Save" [ref=f2e132]
              - generic [ref=f2e133]:
                - generic [ref=f2e134]:
                  - generic [ref=f2e139]: DeepSeek API Key
                  - generic [ref=f2e140]: Optional
                - paragraph [ref=f2e141]: Loading…
                - generic [ref=f2e142]:
                  - textbox "sk-…" [ref=f2e143]
                  - button "Save" [disabled]
              - generic [ref=f2e144]:
                - generic [ref=f2e145]: Groq API Key
                - paragraph [ref=f2e151]: Loading…
                - generic [ref=f2e152]:
                  - textbox "gsk_…" [ref=f2e153]
                  - button "Save" [disabled]
          - generic [ref=f2e154]:
            - generic [ref=f2e155]:
              - generic [ref=f2e159]: EngineeringOS AI
              - generic [ref=f2e160]: Llama 3.3 · Groq
            - generic [ref=f2e164]:
              - generic "Agent execution proof" [ref=f2e165]:
                - generic [ref=f2e170]:
                  - generic [ref=f2e171]:
                    - generic [ref=f2e172]: Agent execution proof
                    - generic [ref=f2e173]: Preparing
                    - generic [ref=f2e174]: "Evidence: INCOMPLETE"
                    - generic [ref=f2e175]: Persisted proof
                    - button "Resume" [ref=f2e177]
                  - paragraph [ref=f2e178]: Execution paused — ready to resume from its durable checkpoint
                  - generic [ref=f2e179]:
                    - generic [ref=f2e180]:
                      - text: "Phase:"
                      - strong [ref=f2e181]: tool-execution
                    - generic [ref=f2e182]:
                      - text: "Attempt:"
                      - strong [ref=f2e183]: "0"
                    - generic [ref=f2e184]:
                      - text: "Revision:"
                      - code [ref=f2e185]: not recorded
                  - generic [ref=f2e186]:
                    - code [ref=f2e187]: Execution e2e-resumed-analysis-failure-execution
                    - link "Open execution in Flight Deck" [ref=f2e188] [cursor=pointer]:
                      - /url: /dashboard/flight-deck?executionId=e2e-resumed-analysis-failure-execution
                      - text: Flight Deck
                  - paragraph [ref=f2e193]: The required analysis did not complete.
                - generic [ref=f2e194]:
                  - generic [ref=f2e195]:
                    - generic [ref=f2e196]: Evidence
                    - generic [ref=f2e197]: Evidence pending
                  - generic [ref=f2e198]:
                    - generic [ref=f2e199]: Agent work
                    - generic [ref=f2e200]: 0/0 tools
                  - generic [ref=f2e201]:
                    - generic [ref=f2e202]: Delivery
                    - generic [ref=f2e203]: No writes applied automatically
                  - generic [ref=f2e204]:
                    - generic [ref=f2e205]: Safety
                    - generic [ref=f2e206]: No automatic writes
                - generic [ref=f2e207]:
                  - generic [ref=f2e208]:
                    - generic [ref=f2e209]: Objective
                    - generic [ref=f2e210]: Verify the analysis evidence after reconnect.
                  - generic [ref=f2e211]:
                    - generic [ref=f2e212]: Scope
                    - generic [ref=f2e213]: 0 files · 0 nodes
                  - generic [ref=f2e214]:
                    - generic [ref=f2e215]: Risk
                    - generic [ref=f2e216]: No unresolved patch risk recorded
                - generic [ref=f2e217]:
                  - generic [ref=f2e218]: checkpoint v1
                  - generic [ref=f2e219]: resume available
              - generic [ref=f2e220]: Verify the analysis evidence after reconnect.
              - generic [ref=f2e232]:
                - generic [ref=f2e233]:
                  - generic [ref=f2e234]: "ANALYSIS_INCOMPLETE: The required analysis did not complete, so no verified result is available."
                  - generic [ref=f2e235]:
                    - generic [ref=f2e236]: Execution failed
                    - generic [ref=f2e237]: Provider failure
                    - generic [ref=f2e238]: The required analysis did not complete.
                    - generic [ref=f2e239]: "Durable execution: e2e-resumed-analysis-failure-execution"
                - button "Forensic evidence INCOMPLETE" [ref=f2e241]:
                  - generic [ref=f2e244]: Forensic evidence
                  - generic [ref=f2e245]: INCOMPLETE
            - generic [ref=f2e248]:
              - generic [ref=f2e249]:
                - generic [ref=f2e250]:
                  - generic [ref=f2e251]: A saved AI execution is ready to resume
                  - generic [ref=f2e252]: Execution e2e-resu… · no file changes were applied automatically · checkpoint 1
                - button "Resume" [ref=f2e254]
              - generic [ref=f2e255]:
                - textbox "Ask about your codebase, tasks, or metrics… (Enter to send)" [ref=f2e256]
                - button [disabled]
  - region "Notifications (F8)":
    - list
```

# Test source

```ts
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
  2720 |     await expect(answer).toHaveCount(1);
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
> 2798 |     const resumeRequest = page.waitForRequest(
       |                                ^ Error: page.waitForRequest: Test ended.
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
  2821 |       page.getByText("A saved AI execution is ready to resume"),
  2822 |     ).toBeVisible();
  2823 |     const visibleText = await page.locator("body").innerText();
  2824 |     expect(visibleText).not.toContain("COMPLETED");
  2825 |     expect(visibleText).not.toContain("Persisted execution proof");
  2826 |     expect(visibleText).toContain("The required analysis did not complete.");
  2827 |   });
  2828 | 
  2829 |   test("recovers a missing token after a real stream abort and resumes one execution", async ({
  2830 |     page,
  2831 |   }) => {
  2832 |     const recovery = installInterruptedResumeFixture();
  2833 |     await installApiFixtures(page, { interruptedResume: recovery });
  2834 |     await page.addInitScript(() => {
  2835 |       const nativeFetch = window.fetch.bind(window);
  2836 |       window.fetch = async (input, init) => {
  2837 |         const url =
  2838 |           typeof input === "string"
  2839 |             ? input
  2840 |             : input instanceof Request
  2841 |               ? input.url
  2842 |               : String(input);
  2843 |         const body = typeof init?.body === "string" ? init.body : "";
  2844 |         if (
  2845 |           !url.includes("/api/ai/chat/stream") ||
  2846 |           body.includes('"executionId"')
  2847 |         ) {
  2848 |           return nativeFetch(input, init);
  2849 |         }
  2850 | 
  2851 |         const response = await nativeFetch(input, init);
  2852 |         if (!response.body) return response;
  2853 |         const reader = response.body.getReader();
  2854 |         const encoder = new TextEncoder();
  2855 |         const stream = new ReadableStream({
  2856 |           async start(controller) {
  2857 |             let buffered = "";
  2858 |             while (true) {
  2859 |               const { done, value } = await reader.read();
  2860 |               if (done) {
  2861 |                 if (buffered) controller.enqueue(encoder.encode(buffered));
  2862 |                 controller.close();
  2863 |                 return;
  2864 |               }
  2865 |               buffered += new TextDecoder().decode(value, { stream: true });
  2866 |               const marker = buffered.indexOf('"type":"execution_started"');
  2867 |               const frameEnd =
  2868 |                 marker < 0 ? -1 : buffered.indexOf("\n\n", marker);
  2869 |               if (frameEnd >= 0) {
  2870 |                 controller.enqueue(
  2871 |                   encoder.encode(buffered.slice(0, frameEnd + 2)),
  2872 |                 );
  2873 |                 controller.error(new TypeError("network connection reset"));
  2874 |                 return;
  2875 |               }
  2876 |             }
  2877 |           },
  2878 |         });
  2879 |         return new Response(stream, {
  2880 |           status: response.status,
  2881 |           statusText: response.statusText,
  2882 |           headers: response.headers,
  2883 |         });
  2884 |       };
  2885 |     });
  2886 |     await programmaticSignIn(page);
  2887 |     await page.goto(`${DASHBOARD_PATH}ai`);
  2888 | 
  2889 |     const streamRequests: Array<Record<string, unknown>> = [];
  2890 |     page.on("request", (request) => {
  2891 |       if (
  2892 |         request.url().includes("/api/ai/chat/stream") &&
  2893 |         request.method() === "POST"
  2894 |       ) {
  2895 |         try {
  2896 |           streamRequests.push(
  2897 |             request.postDataJSON() as Record<string, unknown>,
  2898 |           );
```