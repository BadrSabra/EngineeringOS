# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: dashboard.journey.ts >> EngineeringOS dashboard browser journey >> keeps only the safe blocked citation reason after chat reload
- Location: e2e/dashboard.journey.ts:2563:3

# Error details

```
Error: expect(locator).toBeVisible() failed

Locator: getByText('required tool did not complete — BLOCKED/INCOMPLETE').last()
Expected: visible
Timeout: 10000ms
Error: element(s) not found

Call log:
  - Expect "toBeVisible" with timeout 10000ms
  - waiting for getByText('required tool did not complete — BLOCKED/INCOMPLETE').last()

```

```yaml
- text: EngineeringOS Core Ops
- link "Dashboard":
  - /url: /dashboard/
- link "Projects":
  - /url: /dashboard/projects
- link "Tasks":
  - /url: /dashboard/tasks
- link "Rules Engine":
  - /url: /dashboard/rules
- link "Workflows":
  - /url: /dashboard/workflows
- link "Event Stream":
  - /url: /dashboard/events
- link "Metrics":
  - /url: /dashboard/metrics
- link "Knowledge Graph":
  - /url: /dashboard/graph
- link "AI Assistant":
  - /url: /dashboard/ai
- link "Flight Deck":
  - /url: /dashboard/flight-deck
- link "Mission Control":
  - /url: /dashboard/mission-control
- text: ED EngineeringOS Dashboard Smoke Connected
- button "Sign out"
- banner:
  - textbox "Search projects, tasks, rules... (Press '/')"
  - text: v1.0.4-stable
  - button
- main:
  - text: Sessions
  - button "New session"
  - combobox:
    - option "Smoke Project" [selected]
  - button "ماذا يحدث عند انتهاء مهلة provider timeout داخل execution-tools.ts؟"
  - text: OpenRouter API Key Priority
  - paragraph: Get a free key at openrouter.ai/keys — routes to 300+ models, used first when configured.
  - textbox "sk-or-…"
  - button "Save" [disabled]
  - text: Gemini API Key Free · Priority
  - paragraph: Free key at aistudio.google.com/apikey — 1,500 req/day, 1M tokens/day.
  - textbox "AIza…"
  - button "Save"
  - text: DeepSeek API Key Optional
  - paragraph: Get a free API key at platform.deepseek.com to use DeepSeek as your AI provider.
  - textbox "sk-…"
  - button "Save" [disabled]
  - text: Groq API Key
  - paragraph: No personal key saved — the server's key will be used if one is configured.
  - textbox "gsk_…"
  - button "Save" [disabled]
  - text: EngineeringOS AI Llama 3.3 · Groq ماذا يحدث عند انتهاء مهلة provider timeout داخل execution-tools.ts؟
  - paragraph: عند انتهاء مهلة مزود الذكاء الاصطناعي، يعيد المسار تقريرًا جزئيًا من الأدلة التي جُمعت بدل إصدار Finding غير مثبت.
  - heading "6) Final Judgment" [level=2]
  - paragraph: NOT PROVEN
  - text: "Behavior evidence · 1 excerpt Accepted: source span verified. return partialFromCollectedEvidence(\"provider timeout\");"
  - button "src/execution-tools.ts:42"
  - button "View file"
  - text: Behavior answer confidence 100%
  - paragraph: عند انتهاء مهلة مزود الذكاء الاصطناعي، يعيد المسار تقريرًا جزئيًا من الأدلة التي جُمعت بدل إصدار Finding غير مثبت.
  - text: "src/execution-tools.ts Answered fields: timeout behavior Behavior evidence · 1 excerpt Accepted: source span verified. return partialFromCollectedEvidence(\"provider timeout\");"
  - button "src/execution-tools.ts:42"
  - button "View file"
  - group: Agent activity · 1 events
  - button "Forensic evidence NOT PROVEN"
  - textbox "Ask about your codebase, tasks, or metrics… (Enter to send)"
  - button [disabled]
- region "Notifications (F8)":
  - list
```

# Test source

```ts
  2484 |           .getByText("Blocked: no matching source text was found.", {
  2485 |             exact: true,
  2486 |           })
  2487 |           .last(),
  2488 |       ).toBeVisible();
  2489 |       await expect(
  2490 |         page.getByText(`${blocked.source}:42`, { exact: false }),
  2491 |       ).toHaveCount(0);
  2492 |       await expect(
  2493 |         page.getByText("Accepted: source span verified.", { exact: true }),
  2494 |       ).toHaveCount(0);
  2495 |     };
  2496 |     const assertNoInternalCitationDetails = async () => {
  2497 |       const visibleText = await page.locator("body").innerText();
  2498 |       expect(visibleText).not.toMatch(
  2499 |         /MISSING_LITERAL_MATCH|rawPrompt|systemPrompt|provider diagnostics|source-window|recovery prompt|\/home\/runner/i,
  2500 |       );
  2501 |     };
  2502 | 
  2503 |     await page
  2504 |       .getByRole("button", { name: accepted.question, exact: true })
  2505 |       .click();
  2506 |     await assertAcceptedCitation();
  2507 | 
  2508 |     await openNavigation(page, "Projects", `${DASHBOARD_PATH}projects`);
  2509 |     await page.goBack();
  2510 |     await expect(page).toHaveURL(
  2511 |       new RegExp(`${DASHBOARD_PATH.replaceAll("/", "\\/")}ai$`),
  2512 |     );
  2513 |     await page
  2514 |       .getByRole("button", { name: accepted.question, exact: true })
  2515 |       .click();
  2516 |     await assertAcceptedCitation();
  2517 |     await assertNoInternalCitationDetails();
  2518 | 
  2519 |     await page.goForward();
  2520 |     await expect(page).toHaveURL(
  2521 |       new RegExp(`${DASHBOARD_PATH.replaceAll("/", "\\/")}projects$`),
  2522 |     );
  2523 |     await page.goBack();
  2524 |     await expect(page).toHaveURL(
  2525 |       new RegExp(`${DASHBOARD_PATH.replaceAll("/", "\\/")}ai$`),
  2526 |     );
  2527 |     await page
  2528 |       .getByRole("button", { name: accepted.question, exact: true })
  2529 |       .click();
  2530 |     await assertAcceptedCitation();
  2531 | 
  2532 |     await page
  2533 |       .getByRole("button", { name: blocked.question, exact: true })
  2534 |       .click();
  2535 |     await assertBlockedCitation();
  2536 | 
  2537 |     await openNavigation(page, "Event Stream", `${DASHBOARD_PATH}events`);
  2538 |     await page.goBack();
  2539 |     await expect(page).toHaveURL(
  2540 |       new RegExp(`${DASHBOARD_PATH.replaceAll("/", "\\/")}ai$`),
  2541 |     );
  2542 |     await page
  2543 |       .getByRole("button", { name: blocked.question, exact: true })
  2544 |       .click();
  2545 |     await assertBlockedCitation();
  2546 |     await assertNoInternalCitationDetails();
  2547 | 
  2548 |     await page.goForward();
  2549 |     await expect(page).toHaveURL(
  2550 |       new RegExp(`${DASHBOARD_PATH.replaceAll("/", "\\/")}events$`),
  2551 |     );
  2552 |     await page.goBack();
  2553 |     await expect(page).toHaveURL(
  2554 |       new RegExp(`${DASHBOARD_PATH.replaceAll("/", "\\/")}ai$`),
  2555 |     );
  2556 |     await page
  2557 |       .getByRole("button", { name: blocked.question, exact: true })
  2558 |       .click();
  2559 |     await assertBlockedCitation();
  2560 |     await assertNoInternalCitationDetails();
  2561 |   });
  2562 | 
  2563 |   test("keeps only the safe blocked citation reason after chat reload", async ({
  2564 |     page,
  2565 |   }) => {
  2566 |     const fixture = await installArabicAiFixture(page);
  2567 |     await installApiFixtures(page, { arabicAi: fixture });
  2568 |     await programmaticSignIn(page);
  2569 |     await page.goto(`${DASHBOARD_PATH}ai`);
  2570 | 
  2571 |     const composer = page.locator("textarea").first();
  2572 |     await composer.fill(fixture.question);
  2573 |     await composer.locator("xpath=..").getByRole("button").click();
  2574 | 
  2575 |     await expect(
  2576 |       page.getByText(fixture.answer, { exact: true }).last(),
  2577 |     ).toBeVisible();
  2578 |     await expect(
  2579 |       page
  2580 |         .getByText("required tool did not complete — BLOCKED/INCOMPLETE", {
  2581 |           exact: false,
  2582 |         })
  2583 |         .last(),
> 2584 |     ).toBeVisible();
       |       ^ Error: expect(locator).toBeVisible() failed
  2585 |     await page
  2586 |       .locator("summary")
  2587 |       .filter({ hasText: "Agent activity" })
  2588 |       .last()
  2589 |       .click();
  2590 |     await expect(page.locator("body")).toContainText("Reading source");
  2591 |     await expect(page.locator("body")).toContainText(
  2592 |       "src/missing-release-fixture.ts",
  2593 |     );
  2594 |     await expect(page.locator("body")).toContainText("Tool failed");
  2595 |     await expect(page.locator("body")).toContainText("TOOL_EXECUTION_FAILED");
  2596 |     await page
  2597 |       .locator("summary")
  2598 |       .filter({ hasText: "Persisted execution proof" })
  2599 |       .last()
  2600 |       .click();
  2601 |     await expect(
  2602 |       page
  2603 |         .getByText("required tool failed — operation blocked", { exact: true })
  2604 |         .last(),
  2605 |     ).toBeVisible();
  2606 | 
  2607 |     const visibleText = await page.locator("body").innerText();
  2608 |     expect(visibleText).not.toContain("COMPLETED");
  2609 |     expect(visibleText).not.toContain("Persisted execution proof");
  2610 |     expect(visibleText).toContain("The required analysis did not complete.");
  2611 |   });
  2612 | 
  2613 |   test("keeps the failed AI session drawer overlaid on a phone viewport", async ({
  2614 |     page,
  2615 |   }) => {
  2616 |     await page.setViewportSize({ width: 390, height: 844 });
  2617 |     const fixture = await installArabicAiFixture(page);
  2618 |     await installApiFixtures(page, { arabicAi: fixture });
  2619 |     await programmaticSignIn(page);
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
```