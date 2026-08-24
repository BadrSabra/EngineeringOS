# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: dashboard.journey.ts >> EngineeringOS dashboard browser journey >> resumes a failed analysis and keeps the execution incomplete
- Location: e2e/dashboard.journey.ts:2643:3

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
  2583 |     ).toBeVisible();
  2584 | 
  2585 |     const reloadedText = await page.locator("body").innerText();
  2586 |     await expectNoHorizontalOverflow(page);
  2587 |     expect(reloadedText).not.toMatch(
  2588 |       /raw exception|stack trace|\/home\/runner|secret|fixture diagnostic/i,
  2589 |     );
  2590 |   });
  2591 | 
  2592 |   test("preserves one partial answer after a provider disconnect and marks it incomplete", async ({
  2593 |     page,
  2594 |   }) => {
  2595 |     const fixture = await installArabicAiFixture(page);
  2596 |     await installApiFixtures(page, { arabicAi: fixture });
  2597 |     await programmaticSignIn(page);
  2598 |     await page.goto(`${DASHBOARD_PATH}ai`);
  2599 | 
  2600 |     const composer = page.locator("textarea").first();
  2601 |     await composer.fill(fixture.question);
  2602 |     await composer.locator("xpath=..").getByRole("button").click();
  2603 | 
  2604 |     const answer = page.getByText(fixture.answer, { exact: true });
  2605 |     await expect(answer).toHaveCount(1);
  2606 |     await expect(answer).toBeVisible();
  2607 |     await expect(page.getByText("INCOMPLETE:", { exact: false })).toBeVisible();
  2608 |     await expect(
  2609 |       page.getByText("provider failure", { exact: false }).last(),
  2610 |     ).toBeVisible();
  2611 |     await expect(
  2612 |       page.getByText("stopped: provider timeout", { exact: false }).last(),
  2613 |     ).toBeVisible();
  2614 |     await expect(
  2615 |       page.getByText("The provider disconnected after visible response text.", {
  2616 |         exact: true,
  2617 |       }),
  2618 |     ).toBeVisible();
  2619 | 
  2620 |     await page.reload();
  2621 |     await page
  2622 |       .getByRole("button", { name: fixture.question, exact: true })
  2623 |       .click();
  2624 | 
  2625 |     await expect(page.getByText(fixture.answer, { exact: true })).toHaveCount(
  2626 |       1,
  2627 |     );
  2628 |     await expect(page.getByText(fixture.answer, { exact: true })).toBeVisible();
  2629 |     await expect(page.getByText("INCOMPLETE:", { exact: false })).toBeVisible();
  2630 |     await expect(
  2631 |       page.getByText("provider failure", { exact: false }).last(),
  2632 |     ).toBeVisible();
  2633 |     await expect(
  2634 |       page.getByText("stopped: provider timeout", { exact: false }).last(),
  2635 |     ).toBeVisible();
  2636 |     await expect(
  2637 |       page.getByText("The provider disconnected after visible response text.", {
  2638 |         exact: true,
  2639 |       }),
  2640 |     ).toBeVisible();
  2641 |   });
  2642 | 
  2643 |   test("resumes a failed analysis and keeps the execution incomplete", async ({
  2644 |     page,
  2645 |   }) => {
  2646 |     const { fixture, execution } = installResumedAnalysisFailureFixture();
  2647 |     await installApiFixtures(page, {
  2648 |       arabicAi: fixture,
  2649 |       resumeFailure: { fixture, execution },
  2650 |     });
  2651 |     await programmaticSignIn(page);
  2652 | 
  2653 |     await page.evaluate(
  2654 |       ({ sessionId, executionId, projectId, resumeToken, message }) => {
  2655 |         localStorage.setItem(
  2656 |           `eos_ai_execution_current_${projectId}`,
  2657 |           sessionId,
  2658 |         );
  2659 |         localStorage.setItem(
  2660 |           `eos_ai_execution_${projectId}_${sessionId}`,
  2661 |           JSON.stringify({
  2662 |             id: executionId,
  2663 |             projectId,
  2664 |             sessionId,
  2665 |             resumeToken,
  2666 |             message,
  2667 |           }),
  2668 |         );
  2669 |       },
  2670 |       {
  2671 |         sessionId: fixture.sessionId,
  2672 |         executionId: fixture.executionId,
  2673 |         projectId: "e2e-project",
  2674 |         resumeToken: "e2e-resumed-analysis-failure-token-opaque",
  2675 |         message: fixture.question,
  2676 |       },
  2677 |     );
  2678 |     await page.goto(`${DASHBOARD_PATH}ai`);
  2679 | 
  2680 |     await expect(
  2681 |       page.getByText("A saved AI execution is ready to resume"),
  2682 |     ).toBeVisible();
> 2683 |     const resumeRequest = page.waitForRequest(
       |                                ^ Error: page.waitForRequest: Test ended.
  2684 |       (request) =>
  2685 |         request.url().includes("/api/ai/chat/stream") &&
  2686 |         request.method() === "POST",
  2687 |     );
  2688 |     await page.getByRole("button", { name: "Resume", exact: true }).click();
  2689 |     const requestBody = JSON.parse(
  2690 |       (await resumeRequest).postData() ?? "{}",
  2691 |     ) as Record<string, unknown>;
  2692 |     expect(requestBody).toEqual(
  2693 |       expect.objectContaining({
  2694 |         projectId: "e2e-project",
  2695 |         sessionId: fixture.sessionId,
  2696 |         executionId: fixture.executionId,
  2697 |         resumeToken: "e2e-resumed-analysis-failure-token-opaque",
  2698 |         message: fixture.question,
  2699 |       }),
  2700 |     );
  2701 | 
  2702 |     await expect(
  2703 |       page.getByText("Failed to send message", { exact: true }),
  2704 |     ).toBeVisible();
  2705 |     await expect(
  2706 |       page.getByText("A saved AI execution is ready to resume"),
  2707 |     ).toBeVisible();
  2708 |     const visibleText = await page.locator("body").innerText();
  2709 |     expect(visibleText).not.toContain("COMPLETED");
  2710 |     expect(visibleText).not.toContain("Persisted execution proof");
  2711 |     expect(visibleText).toContain("The required analysis did not complete.");
  2712 |   });
  2713 | 
  2714 |   test("recovers a missing token after a real stream abort and resumes one execution", async ({
  2715 |     page,
  2716 |   }) => {
  2717 |     const recovery = installInterruptedResumeFixture();
  2718 |     await installApiFixtures(page, { interruptedResume: recovery });
  2719 |     await page.addInitScript(() => {
  2720 |       const nativeFetch = window.fetch.bind(window);
  2721 |       window.fetch = async (input, init) => {
  2722 |         const url =
  2723 |           typeof input === "string"
  2724 |             ? input
  2725 |             : input instanceof Request
  2726 |               ? input.url
  2727 |               : String(input);
  2728 |         const body = typeof init?.body === "string" ? init.body : "";
  2729 |         if (
  2730 |           !url.includes("/api/ai/chat/stream") ||
  2731 |           body.includes('"executionId"')
  2732 |         ) {
  2733 |           return nativeFetch(input, init);
  2734 |         }
  2735 | 
  2736 |         const response = await nativeFetch(input, init);
  2737 |         if (!response.body) return response;
  2738 |         const reader = response.body.getReader();
  2739 |         const encoder = new TextEncoder();
  2740 |         const stream = new ReadableStream({
  2741 |           async start(controller) {
  2742 |             let buffered = "";
  2743 |             while (true) {
  2744 |               const { done, value } = await reader.read();
  2745 |               if (done) {
  2746 |                 if (buffered) controller.enqueue(encoder.encode(buffered));
  2747 |                 controller.close();
  2748 |                 return;
  2749 |               }
  2750 |               buffered += new TextDecoder().decode(value, { stream: true });
  2751 |               const marker = buffered.indexOf('"type":"execution_started"');
  2752 |               const frameEnd =
  2753 |                 marker < 0 ? -1 : buffered.indexOf("\n\n", marker);
  2754 |               if (frameEnd >= 0) {
  2755 |                 controller.enqueue(
  2756 |                   encoder.encode(buffered.slice(0, frameEnd + 2)),
  2757 |                 );
  2758 |                 controller.error(new TypeError("network connection reset"));
  2759 |                 return;
  2760 |               }
  2761 |             }
  2762 |           },
  2763 |         });
  2764 |         return new Response(stream, {
  2765 |           status: response.status,
  2766 |           statusText: response.statusText,
  2767 |           headers: response.headers,
  2768 |         });
  2769 |       };
  2770 |     });
  2771 |     await programmaticSignIn(page);
  2772 |     await page.goto(`${DASHBOARD_PATH}ai`);
  2773 | 
  2774 |     const streamRequests: Array<Record<string, unknown>> = [];
  2775 |     page.on("request", (request) => {
  2776 |       if (
  2777 |         request.url().includes("/api/ai/chat/stream") &&
  2778 |         request.method() === "POST"
  2779 |       ) {
  2780 |         try {
  2781 |           streamRequests.push(
  2782 |             request.postDataJSON() as Record<string, unknown>,
  2783 |           );
```