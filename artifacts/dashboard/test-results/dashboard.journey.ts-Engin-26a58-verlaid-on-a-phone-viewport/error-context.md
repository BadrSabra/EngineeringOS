# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: dashboard.journey.ts >> EngineeringOS dashboard browser journey >> keeps the failed AI session drawer overlaid on a phone viewport
- Location: e2e/dashboard.journey.ts:2498:3

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
  2420 |     await assertBlockedCitation();
  2421 | 
  2422 |     await openNavigation(page, "Event Stream", `${DASHBOARD_PATH}events`);
  2423 |     await page.goBack();
  2424 |     await expect(page).toHaveURL(
  2425 |       new RegExp(`${DASHBOARD_PATH.replaceAll("/", "\\/")}ai$`),
  2426 |     );
  2427 |     await page
  2428 |       .getByRole("button", { name: blocked.question, exact: true })
  2429 |       .click();
  2430 |     await assertBlockedCitation();
  2431 |     await assertNoInternalCitationDetails();
  2432 | 
  2433 |     await page.goForward();
  2434 |     await expect(page).toHaveURL(
  2435 |       new RegExp(`${DASHBOARD_PATH.replaceAll("/", "\\/")}events$`),
  2436 |     );
  2437 |     await page.goBack();
  2438 |     await expect(page).toHaveURL(
  2439 |       new RegExp(`${DASHBOARD_PATH.replaceAll("/", "\\/")}ai$`),
  2440 |     );
  2441 |     await page
  2442 |       .getByRole("button", { name: blocked.question, exact: true })
  2443 |       .click();
  2444 |     await assertBlockedCitation();
  2445 |     await assertNoInternalCitationDetails();
  2446 |   });
  2447 | 
  2448 |   test("keeps only the safe blocked citation reason after chat reload", async ({
  2449 |     page,
  2450 |   }) => {
  2451 |     const fixture = await installArabicAiFixture(page);
  2452 |     await installApiFixtures(page, { arabicAi: fixture });
  2453 |     await programmaticSignIn(page);
  2454 |     await page.goto(`${DASHBOARD_PATH}ai`);
  2455 | 
  2456 |     const composer = page.locator("textarea").first();
  2457 |     await composer.fill(fixture.question);
  2458 |     await composer.locator("xpath=..").getByRole("button").click();
  2459 | 
  2460 |     await expect(
  2461 |       page.getByText(fixture.answer, { exact: true }).last(),
  2462 |     ).toBeVisible();
  2463 |     await expect(
  2464 |       page
  2465 |         .getByText("required tool did not complete — BLOCKED/INCOMPLETE", {
  2466 |           exact: false,
  2467 |         })
  2468 |         .last(),
  2469 |     ).toBeVisible();
  2470 |     await page
  2471 |       .locator("summary")
  2472 |       .filter({ hasText: "Agent activity" })
  2473 |       .last()
  2474 |       .click();
  2475 |     await expect(page.locator("body")).toContainText("Reading source");
  2476 |     await expect(page.locator("body")).toContainText(
  2477 |       "src/missing-release-fixture.ts",
  2478 |     );
  2479 |     await expect(page.locator("body")).toContainText("Tool failed");
  2480 |     await expect(page.locator("body")).toContainText("TOOL_EXECUTION_FAILED");
  2481 |     await page
  2482 |       .locator("summary")
  2483 |       .filter({ hasText: "Persisted execution proof" })
  2484 |       .last()
  2485 |       .click();
  2486 |     await expect(
  2487 |       page
  2488 |         .getByText("required tool failed — operation blocked", { exact: true })
  2489 |         .last(),
  2490 |     ).toBeVisible();
  2491 | 
  2492 |     const visibleText = await page.locator("body").innerText();
  2493 |     expect(visibleText).not.toContain("COMPLETED");
  2494 |     expect(visibleText).not.toContain("Persisted execution proof");
  2495 |     expect(visibleText).toContain("The required analysis did not complete.");
  2496 |   });
  2497 | 
  2498 |   test("keeps the failed AI session drawer overlaid on a phone viewport", async ({
  2499 |     page,
  2500 |   }) => {
  2501 |     await page.setViewportSize({ width: 390, height: 844 });
  2502 |     const fixture = await installArabicAiFixture(page);
  2503 |     await installApiFixtures(page, { arabicAi: fixture });
  2504 |     await programmaticSignIn(page);
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
> 2520 |     ).toBeVisible();
       |       ^ Error: expect(locator).toBeVisible() failed
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
```