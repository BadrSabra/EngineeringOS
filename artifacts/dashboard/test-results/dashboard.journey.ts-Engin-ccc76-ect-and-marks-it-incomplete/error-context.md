# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: dashboard.journey.ts >> EngineeringOS dashboard browser journey >> preserves one partial answer after a provider disconnect and marks it incomplete
- Location: e2e/dashboard.journey.ts:2592:3

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
  2505 |     await page.goto(`${DASHBOARD_PATH}ai`);
  2506 | 
  2507 |     const composer = page.locator("textarea").first();
  2508 |     await composer.fill(fixture.question);
  2509 |     await composer.locator("xpath=..").getByRole("button").click();
  2510 | 
  2511 |     await expect(
  2512 |       page.getByText(fixture.answer, { exact: true }).last(),
  2513 |     ).toBeVisible();
  2514 |     await expect(
  2515 |       page
  2516 |         .getByText("required tool did not complete — BLOCKED/INCOMPLETE", {
  2517 |           exact: false,
  2518 |         })
  2519 |         .last(),
  2520 |     ).toBeVisible();
  2521 |     await page
  2522 |       .locator("summary")
  2523 |       .filter({ hasText: "Agent activity" })
  2524 |       .last()
  2525 |       .click();
  2526 |     await expect(page.locator("body")).toContainText("Reading source");
  2527 |     await expect(page.locator("body")).toContainText(
  2528 |       "src/missing-release-fixture.ts",
  2529 |     );
  2530 |     await expect(page.locator("body")).toContainText("Tool failed");
  2531 |     await expect(page.locator("body")).toContainText("TOOL_EXECUTION_FAILED");
  2532 |     await page
  2533 |       .locator("summary")
  2534 |       .filter({ hasText: "Persisted execution proof" })
  2535 |       .last()
  2536 |       .click();
  2537 |     await expect(
  2538 |       page
  2539 |         .getByText("required tool failed — operation blocked", { exact: true })
  2540 |         .last(),
  2541 |     ).toBeVisible();
  2542 | 
  2543 |     const visibleText = await page.locator("body").innerText();
  2544 |     expect(visibleText).not.toMatch(
  2545 |       /raw exception|stack trace|\/home\/runner|secret|fixture diagnostic/i,
  2546 |     );
  2547 | 
  2548 |     await page.reload();
  2549 |     await page
  2550 |       .getByRole("button", { name: fixture.question, exact: true })
  2551 |       .click();
  2552 | 
  2553 |     await expect(
  2554 |       page.getByText(fixture.answer, { exact: true }).last(),
  2555 |     ).toBeVisible();
  2556 |     await expect(
  2557 |       page
  2558 |         .getByText("required tool did not complete — BLOCKED/INCOMPLETE", {
  2559 |           exact: false,
  2560 |         })
  2561 |         .last(),
  2562 |     ).toBeVisible();
  2563 |     await page
  2564 |       .locator("summary")
  2565 |       .filter({ hasText: "Agent activity" })
  2566 |       .last()
  2567 |       .click();
  2568 |     await expect(page.locator("body")).toContainText("Reading source");
  2569 |     await expect(page.locator("body")).toContainText(
  2570 |       "src/missing-release-fixture.ts",
  2571 |     );
  2572 |     await expect(page.locator("body")).toContainText("Tool failed");
  2573 |     await expect(page.locator("body")).toContainText("TOOL_EXECUTION_FAILED");
  2574 |     await page
  2575 |       .locator("summary")
  2576 |       .filter({ hasText: "Persisted execution proof" })
  2577 |       .last()
  2578 |       .click();
  2579 |     await expect(
  2580 |       page
  2581 |         .getByText("required tool failed — operation blocked", { exact: true })
  2582 |         .last(),
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
> 2605 |     await expect(answer).toHaveCount(1);
       |                          ^ Error: expect(locator).toHaveCount(expected) failed
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
  2683 |     const resumeRequest = page.waitForRequest(
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
```