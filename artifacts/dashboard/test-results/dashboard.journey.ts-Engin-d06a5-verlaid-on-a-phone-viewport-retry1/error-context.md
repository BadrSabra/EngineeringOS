# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: dashboard.journey.ts >> EngineeringOS dashboard browser journey >> keeps the AI session drawer overlaid on a phone viewport
- Location: e2e/dashboard.journey.ts:422:3

# Error details

```
Test timeout of 45000ms exceeded.
```

```
Error: locator.click: Test timeout of 45000ms exceeded.
Call log:
  - waiting for getByRole('button', { name: 'Close sessions' })
    - locator resolved to <button type="button" aria-label="Close sessions" class="absolute inset-0 z-20 bg-black/55 md:hidden"></button>
  - attempting click action
    2 × waiting for element to be visible, enabled and stable
      - element is visible, enabled and stable
      - scrolling into view if needed
      - done scrolling
      - <div class="border-t border-border pt-2">…</div> from <div class="flex absolute inset-y-0 left-0 z-30 w-64 max-w-[calc(100vw-1rem)] border-r border-border flex-col shrink-0 bg-background shadow-2xl transition-transform md:relative md:inset-y-auto md:z-auto md:flex md:w-56 md:max-w-none md:shadow-none">…</div> subtree intercepts pointer events
    - retrying click action
    - waiting 20ms
    2 × waiting for element to be visible, enabled and stable
      - element is visible, enabled and stable
      - scrolling into view if needed
      - done scrolling
      - <div class="border-t border-border pt-2">…</div> from <div class="flex absolute inset-y-0 left-0 z-30 w-64 max-w-[calc(100vw-1rem)] border-r border-border flex-col shrink-0 bg-background shadow-2xl transition-transform md:relative md:inset-y-auto md:z-auto md:flex md:w-56 md:max-w-none md:shadow-none">…</div> subtree intercepts pointer events
    - retrying click action
      - waiting 100ms
    - waiting for element to be visible, enabled and stable
    - element is visible, enabled and stable
    - scrolling into view if needed
    - done scrolling
    - <div class="border-t border-border pt-2">…</div> from <div class="flex absolute inset-y-0 left-0 z-30 w-64 max-w-[calc(100vw-1rem)] border-r border-border flex-col shrink-0 bg-background shadow-2xl transition-transform md:relative md:inset-y-auto md:z-auto md:flex md:w-56 md:max-w-none md:shadow-none">…</div> subtree intercepts pointer events
  2 × retrying click action
      - waiting 500ms
      - waiting for element to be visible, enabled and stable
      - element is visible, enabled and stable
      - scrolling into view if needed
      - done scrolling
      - <div class="mx-2 mb-2 rounded-lg border border-border bg-secondary/50 p-3 text-xs">…</div> from <div class="flex absolute inset-y-0 left-0 z-30 w-64 max-w-[calc(100vw-1rem)] border-r border-border flex-col shrink-0 bg-background shadow-2xl transition-transform md:relative md:inset-y-auto md:z-auto md:flex md:w-56 md:max-w-none md:shadow-none">…</div> subtree intercepts pointer events
  - retrying click action
    - waiting 500ms
  - element was detached from the DOM, retrying

```

# Page snapshot

```yaml
- generic [ref=f3e2]:
  - generic [ref=f3e4]:
    - banner [ref=f3e5]:
      - generic [ref=f3e6]:
        - button "Open navigation" [ref=f3e7]
        - textbox "Search projects, tasks, rules... (Press '/')" [ref=f3e12]
      - button [ref=f3e14]
    - main [ref=f3e19]:
      - generic [ref=f3e22]:
        - generic [ref=f3e23]:
          - button "Open sessions" [ref=f3e24]
          - generic [ref=f3e28]: EngineeringOS AI
          - generic [ref=f3e29]: Llama 3.3 · Groq
        - generic [ref=f3e33]:
          - generic [ref=f3e34]:
            - paragraph [ref=f3e39]: How can I help with your project?
            - paragraph [ref=f3e40]: Ask about your codebase, tasks, metrics, or workflows. I have full context.
          - generic [ref=f3e41]:
            - button "Analyze Scan" [ref=f3e42]
            - button "Code Review" [ref=f3e46]
            - button "Task Status" [ref=f3e51]
            - button "Workflow Health" [ref=f3e54]
            - button "Capability Probe" [ref=f3e59]
        - generic [ref=f3e63]:
          - textbox "Ask about your codebase, tasks, or metrics… (Enter to send)" [ref=f3e64]
          - button [disabled]
  - region "Notifications (F8)":
    - list
```

# Test source

```ts
  344 |     await openNavigation(page, "Projects", `${DASHBOARD_PATH}projects`);
  345 |     await expect(page.getByRole("heading", { name: "Projects" })).toBeVisible();
  346 |     await expect(
  347 |       page.getByText("Smoke Project", { exact: true }),
  348 |     ).toBeVisible();
  349 | 
  350 |     await openNavigation(page, "Event Stream", `${DASHBOARD_PATH}events`);
  351 |     await expect(
  352 |       page.getByRole("heading", { name: "Event Stream" }),
  353 |     ).toBeVisible();
  354 |     await expect(
  355 |       page.getByText("Dashboard API fixture ready", { exact: true }),
  356 |     ).toBeVisible();
  357 | 
  358 |     await openNavigation(page, "AI Assistant", `${DASHBOARD_PATH}ai`);
  359 |     await expect(page).not.toHaveURL(/sign-in/);
  360 |     await expect(
  361 |       page
  362 |         .getByText(
  363 |           /AI provider not configured|No AI key configured|AI Assistant/i,
  364 |         )
  365 |         .first(),
  366 |     ).toBeVisible();
  367 | 
  368 |     await openNavigation(
  369 |       page,
  370 |       "Mission Control",
  371 |       `${DASHBOARD_PATH}mission-control`,
  372 |     );
  373 |     await expect(
  374 |       page.getByRole("heading", { name: "No durable runs in the ledger" }),
  375 |     ).toBeVisible();
  376 | 
  377 |     await page.goto(`${DASHBOARD_PATH}flight-deck?executionId=${EXECUTION_ID}`);
  378 |     await expect(page).toHaveURL(
  379 |       new RegExp(
  380 |         `${DASHBOARD_PATH.replaceAll("/", "\\/")}flight-deck\\?executionId=`,
  381 |       ),
  382 |     );
  383 |     await expect(
  384 |       page.getByRole("heading", { name: "Audit / Chat run" }),
  385 |     ).toBeVisible();
  386 |     await expect(
  387 |       page.getByText("Controlled browser fixture completed.", { exact: true }),
  388 |     ).toBeVisible();
  389 |     await expect(
  390 |       page.getByText("PROVEN", { exact: true }).first(),
  391 |     ).toBeVisible();
  392 |   });
  393 | 
  394 |   test("renders an Arabic source-backed AI answer without internal diagnostics", async ({
  395 |     page,
  396 |   }) => {
  397 |     const fixture = await installArabicAiFixture(page);
  398 |     await installApiFixtures(page, { arabicAi: fixture });
  399 |     await programmaticSignIn(page);
  400 |     await page.goto(`${DASHBOARD_PATH}ai`);
  401 | 
  402 |     const composer = page.locator("textarea").first();
  403 |     await expect(composer).toBeVisible();
  404 |     await composer.fill(fixture.question);
  405 |     const sendButton = composer.locator("xpath=..").getByRole("button");
  406 |     await expect(sendButton).toBeEnabled();
  407 |     const streamResponsePromise = page.waitForResponse((response) =>
  408 |       response.url().includes("/api/ai/chat/stream"),
  409 |     );
  410 |     await sendButton.click();
  411 |     const streamResponse = await streamResponsePromise;
  412 |     expect(streamResponse.status()).toBe(200);
  413 | 
  414 |     await expect(page.getByText(fixture.question, { exact: true })).toBeVisible();
  415 |     await expect(page.getByText(fixture.answer, { exact: true })).toBeVisible();
  416 |     await expect(page.getByText("Agent activity", { exact: false })).toBeVisible();
  417 |     await expect(page.getByText("Reading source", { exact: false })).toBeVisible();
  418 |     await expect(page.getByText(fixture.source, { exact: true })).toBeVisible();
  419 |     await expect(page.getByText(/claim-bound evidence excerpt retained/i)).toBeVisible();
  420 | 
  421 |     const visibleText = await page.locator("body").innerText();
  422 |     expect(visibleText).not.toMatch(/e2e-arabic-ai-session|e2e-execution|\/home\/runner|recovery diagnostics|rawPrompt|systemPrompt/i);
  423 |     expect(visibleText).not.toContain("تعذر عرض الاستجابة");
  424 |     expect(visibleText).toContain("تقريرًا جزئيًا");
  425 |   });
  426 | 
  427 |   test("keeps the AI session drawer overlaid on a phone viewport", async ({
  428 |     page,
  429 |   }) => {
  430 |     await page.setViewportSize({ width: 390, height: 844 });
  431 |     const fixture = await installArabicAiFixture(page);
  432 |     await installApiFixtures(page, { arabicAi: fixture });
  433 |     await programmaticSignIn(page);
  434 |     await page.goto(`${DASHBOARD_PATH}ai`);
  435 | 
  436 |     const composer = page.locator("textarea").first();
  437 |     await expect(composer).toBeVisible();
  438 |     const beforeOpen = await composer.boundingBox();
  439 |     expect(beforeOpen?.width).toBeGreaterThan(250);
  440 | 
  441 |     await page.getByRole("button", { name: "Open sessions" }).click();
  442 |     await expect(page.getByText("Sessions", { exact: true })).toBeVisible();
  443 |     const drawer = page.getByText("Sessions", { exact: true }).locator("..").locator("..");
> 444 |     const drawerBox = await drawer.boundingBox();
      |                                                                ^ Error: locator.click: Test timeout of 45000ms exceeded.
  445 |     expect(drawerBox?.width).toBeLessThanOrEqual(390);
  446 |     const duringOpen = await composer.boundingBox();
  447 |     expect(duringOpen?.width).toBeGreaterThan(250);
  448 | 
  449 |     await page.getByRole("button", { name: "Close sessions" }).click();
  450 |     await expect(page.getByRole("button", { name: "Open sessions" })).toBeVisible();
  451 |   });
  452 | 
  453 |   test("renders a user-visible API failure state", async ({ page }) => {
  454 |     await page.route("**/api/dashboard", (route) =>
  455 |       route.fulfill(
  456 |         jsonResponse({ error: "controlled dashboard outage" }, 503),
  457 |       ),
  458 |     );
  459 |     await programmaticSignIn(page);
  460 |     await expect(
  461 |       page.getByRole("heading", { name: "Failed to load dashboard" }),
  462 |     ).toBeVisible();
  463 |     await expect(
  464 |       page.getByRole("button", { name: "Retry Connection" }),
  465 |     ).toBeVisible();
  466 |   });
  467 | });
  468 | 
```