# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: dashboard.journey.ts >> EngineeringOS dashboard browser journey >> keeps only the safe blocked citation reason after chat reload
- Location: e2e/dashboard.journey.ts:2539:3

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
  2460 |           .getByText("Blocked: no matching source text was found.", {
  2461 |             exact: true,
  2462 |           })
  2463 |           .last(),
  2464 |       ).toBeVisible();
  2465 |       await expect(
  2466 |         page.getByText(`${blocked.source}:42`, { exact: false }),
  2467 |       ).toHaveCount(0);
  2468 |       await expect(
  2469 |         page.getByText("Accepted: source span verified.", { exact: true }),
  2470 |       ).toHaveCount(0);
  2471 |     };
  2472 |     const assertNoInternalCitationDetails = async () => {
  2473 |       const visibleText = await page.locator("body").innerText();
  2474 |       expect(visibleText).not.toMatch(
  2475 |         /MISSING_LITERAL_MATCH|rawPrompt|systemPrompt|provider diagnostics|source-window|recovery prompt|\/home\/runner/i,
  2476 |       );
  2477 |     };
  2478 | 
  2479 |     await page
  2480 |       .getByRole("button", { name: accepted.question, exact: true })
  2481 |       .click();
  2482 |     await assertAcceptedCitation();
  2483 | 
  2484 |     await openNavigation(page, "Projects", `${DASHBOARD_PATH}projects`);
  2485 |     await page.goBack();
  2486 |     await expect(page).toHaveURL(
  2487 |       new RegExp(`${DASHBOARD_PATH.replaceAll("/", "\\/")}ai$`),
  2488 |     );
  2489 |     await page
  2490 |       .getByRole("button", { name: accepted.question, exact: true })
  2491 |       .click();
  2492 |     await assertAcceptedCitation();
  2493 |     await assertNoInternalCitationDetails();
  2494 | 
  2495 |     await page.goForward();
  2496 |     await expect(page).toHaveURL(
  2497 |       new RegExp(`${DASHBOARD_PATH.replaceAll("/", "\\/")}projects$`),
  2498 |     );
  2499 |     await page.goBack();
  2500 |     await expect(page).toHaveURL(
  2501 |       new RegExp(`${DASHBOARD_PATH.replaceAll("/", "\\/")}ai$`),
  2502 |     );
  2503 |     await page
  2504 |       .getByRole("button", { name: accepted.question, exact: true })
  2505 |       .click();
  2506 |     await assertAcceptedCitation();
  2507 | 
  2508 |     await page
  2509 |       .getByRole("button", { name: blocked.question, exact: true })
  2510 |       .click();
  2511 |     await assertBlockedCitation();
  2512 | 
  2513 |     await openNavigation(page, "Event Stream", `${DASHBOARD_PATH}events`);
  2514 |     await page.goBack();
  2515 |     await expect(page).toHaveURL(
  2516 |       new RegExp(`${DASHBOARD_PATH.replaceAll("/", "\\/")}ai$`),
  2517 |     );
  2518 |     await page
  2519 |       .getByRole("button", { name: blocked.question, exact: true })
  2520 |       .click();
  2521 |     await assertBlockedCitation();
  2522 |     await assertNoInternalCitationDetails();
  2523 | 
  2524 |     await page.goForward();
  2525 |     await expect(page).toHaveURL(
  2526 |       new RegExp(`${DASHBOARD_PATH.replaceAll("/", "\\/")}events$`),
  2527 |     );
  2528 |     await page.goBack();
  2529 |     await expect(page).toHaveURL(
  2530 |       new RegExp(`${DASHBOARD_PATH.replaceAll("/", "\\/")}ai$`),
  2531 |     );
  2532 |     await page
  2533 |       .getByRole("button", { name: blocked.question, exact: true })
  2534 |       .click();
  2535 |     await assertBlockedCitation();
  2536 |     await assertNoInternalCitationDetails();
  2537 |   });
  2538 | 
  2539 |   test("keeps only the safe blocked citation reason after chat reload", async ({
  2540 |     page,
  2541 |   }) => {
  2542 |     const fixture = await installArabicAiFixture(page);
  2543 |     await installApiFixtures(page, { arabicAi: fixture });
  2544 |     await programmaticSignIn(page);
  2545 |     await page.goto(`${DASHBOARD_PATH}ai`);
  2546 | 
  2547 |     const composer = page.locator("textarea").first();
  2548 |     await composer.fill(fixture.question);
  2549 |     await composer.locator("xpath=..").getByRole("button").click();
  2550 | 
  2551 |     await expect(
  2552 |       page.getByText(fixture.answer, { exact: true }).last(),
  2553 |     ).toBeVisible();
  2554 |     await expect(
  2555 |       page
  2556 |         .getByText("required tool did not complete — BLOCKED/INCOMPLETE", {
  2557 |           exact: false,
  2558 |         })
  2559 |         .last(),
> 2560 |     ).toBeVisible();
       |       ^ Error: expect(locator).toBeVisible() failed
  2561 |     await page
  2562 |       .locator("summary")
  2563 |       .filter({ hasText: "Agent activity" })
  2564 |       .last()
  2565 |       .click();
  2566 |     await expect(page.locator("body")).toContainText("Reading source");
  2567 |     await expect(page.locator("body")).toContainText(
  2568 |       "src/missing-release-fixture.ts",
  2569 |     );
  2570 |     await expect(page.locator("body")).toContainText("Tool failed");
  2571 |     await expect(page.locator("body")).toContainText("TOOL_EXECUTION_FAILED");
  2572 |     await page
  2573 |       .locator("summary")
  2574 |       .filter({ hasText: "Persisted execution proof" })
  2575 |       .last()
  2576 |       .click();
  2577 |     await expect(
  2578 |       page
  2579 |         .getByText("required tool failed — operation blocked", { exact: true })
  2580 |         .last(),
  2581 |     ).toBeVisible();
  2582 | 
  2583 |     const visibleText = await page.locator("body").innerText();
  2584 |     expect(visibleText).not.toContain("COMPLETED");
  2585 |     expect(visibleText).not.toContain("Persisted execution proof");
  2586 |     expect(visibleText).toContain("The required analysis did not complete.");
  2587 |   });
  2588 | 
  2589 |   test("keeps the failed AI session drawer overlaid on a phone viewport", async ({
  2590 |     page,
  2591 |   }) => {
  2592 |     await page.setViewportSize({ width: 390, height: 844 });
  2593 |     const fixture = await installArabicAiFixture(page);
  2594 |     await installApiFixtures(page, { arabicAi: fixture });
  2595 |     await programmaticSignIn(page);
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
```