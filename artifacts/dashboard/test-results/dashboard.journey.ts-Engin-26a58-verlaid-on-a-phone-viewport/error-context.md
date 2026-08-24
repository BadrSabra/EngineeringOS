# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: dashboard.journey.ts >> EngineeringOS dashboard browser journey >> keeps the failed AI session drawer overlaid on a phone viewport
- Location: e2e/dashboard.journey.ts:2589:3

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
- banner:
  - button "Open navigation"
  - textbox "Search projects, tasks, rules... (Press '/')"
  - button
- main:
  - button "Open sessions"
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
  2560 |     ).toBeVisible();
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
> 2611 |     ).toBeVisible();
       |       ^ Error: expect(locator).toBeVisible() failed
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
  2696 |     await expect(answer).toHaveCount(1);
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
```