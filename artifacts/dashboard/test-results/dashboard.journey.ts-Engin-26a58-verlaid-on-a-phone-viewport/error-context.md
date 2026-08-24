# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: dashboard.journey.ts >> EngineeringOS dashboard browser journey >> keeps the failed AI session drawer overlaid on a phone viewport
- Location: e2e/dashboard.journey.ts:2613:3

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
  2584 |     ).toBeVisible();
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
> 2635 |     ).toBeVisible();
       |       ^ Error: expect(locator).toBeVisible() failed
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
```