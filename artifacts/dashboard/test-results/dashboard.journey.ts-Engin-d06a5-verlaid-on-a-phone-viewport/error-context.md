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
  75 × retrying click action
       - waiting 500ms
       - waiting for element to be visible, enabled and stable
       - element is visible, enabled and stable
       - scrolling into view if needed
       - done scrolling
       - <div class="mx-2 mb-2 rounded-lg border border-border bg-secondary/50 p-3 text-xs">…</div> from <div class="flex absolute inset-y-0 left-0 z-30 w-64 max-w-[calc(100vw-1rem)] border-r border-border flex-col shrink-0 bg-background shadow-2xl transition-transform md:relative md:inset-y-auto md:z-auto md:flex md:w-56 md:max-w-none md:shadow-none">…</div> subtree intercepts pointer events
  - retrying click action
    - waiting 500ms

```

# Page snapshot

```yaml
- generic [ref=f2e2]:
  - generic [ref=f2e4]:
    - banner [ref=f2e5]:
      - generic [ref=f2e6]:
        - button "Open navigation" [ref=f2e7]
        - textbox "Search projects, tasks, rules... (Press '/')" [ref=f2e12]
      - button [ref=f2e14]
    - main [ref=f2e19]:
      - generic [ref=f2e21]:
        - button "Close sessions" [ref=f2e22]
        - generic [ref=f2e23]:
          - generic [ref=f2e24]:
            - generic [ref=f2e25]: Sessions
            - generic [ref=f2e26]:
              - button "New session" [ref=f2e27]
              - button "Close sidebar" [ref=f2e28]
          - combobox [ref=f2e31]:
            - option "Smoke Project" [selected]
          - generic [ref=f2e34]:
            - generic [ref=f2e35]:
              - generic [ref=f2e36]:
                - generic [ref=f2e41]: OpenRouter API Key
                - generic [ref=f2e42]: Priority
              - paragraph [ref=f2e43]: Get a free key at openrouter.ai/keys — routes to 300+ models, used first when configured.
              - generic [ref=f2e44]:
                - textbox "sk-or-…" [ref=f2e45]
                - button "Save" [disabled]
            - generic [ref=f2e46]:
              - generic [ref=f2e47]:
                - generic [ref=f2e52]: Gemini API Key
                - generic [ref=f2e53]: Free · Priority
              - paragraph [ref=f2e54]: Free key at aistudio.google.com/apikey — 1,500 req/day, 1M tokens/day.
              - generic [ref=f2e55]:
                - textbox "AIza…" [ref=f2e56]
                - button "Save" [ref=f2e57]
            - generic [ref=f2e58]:
              - generic [ref=f2e59]:
                - generic [ref=f2e64]: DeepSeek API Key
                - generic [ref=f2e65]: Optional
              - paragraph [ref=f2e66]: Get a free API key at platform.deepseek.com to use DeepSeek as your AI provider.
              - generic [ref=f2e67]:
                - textbox "sk-…" [ref=f2e68]
                - button "Save" [disabled]
            - generic [ref=f2e69]:
              - generic [ref=f2e70]: Groq API Key
              - paragraph [ref=f2e76]: No personal key saved — the server's key will be used if one is configured.
              - generic [ref=f2e77]:
                - textbox "gsk_…" [ref=f2e78]
                - button "Save" [disabled]
        - generic [ref=f2e79]:
          - generic [ref=f2e80]:
            - generic [ref=f2e84]: EngineeringOS AI
            - generic [ref=f2e85]: Llama 3.3 · Groq
          - generic [ref=f2e89]:
            - generic [ref=f2e90]:
              - paragraph [ref=f2e95]: How can I help with your project?
              - paragraph [ref=f2e96]: Ask about your codebase, tasks, metrics, or workflows. I have full context.
            - generic [ref=f2e97]:
              - button "Analyze Scan" [ref=f2e98]
              - button "Code Review" [ref=f2e102]
              - button "Task Status" [ref=f2e107]
              - button "Workflow Health" [ref=f2e110]
              - button "Capability Probe" [ref=f2e115]
          - generic [ref=f2e119]:
            - textbox "Ask about your codebase, tasks, or metrics… (Enter to send)" [ref=f2e120]
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
  407 |     await sendButton.click();
  408 | 
  409 |     await expect(page.getByText(fixture.question, { exact: true })).toBeVisible();
  410 |     await expect(page.getByText(fixture.answer, { exact: true })).toBeVisible();
  411 |     await expect(page.getByText("Agent activity", { exact: false })).toBeVisible();
  412 |     await expect(page.getByText("Reading source", { exact: false })).toBeVisible();
  413 |     await expect(page.getByText(fixture.source, { exact: true })).toBeVisible();
  414 |     await expect(page.getByText(/claim-bound evidence excerpt retained/i)).toBeVisible();
  415 | 
  416 |     const visibleText = await page.locator("body").innerText();
  417 |     expect(visibleText).not.toMatch(/e2e-arabic-ai-session|e2e-execution|\/home\/runner|recovery diagnostics|rawPrompt|systemPrompt/i);
  418 |     expect(visibleText).not.toContain("تعذر عرض الاستجابة");
  419 |     expect(visibleText).toContain("تقريرًا جزئيًا");
  420 |   });
  421 | 
  422 |   test("keeps the AI session drawer overlaid on a phone viewport", async ({
  423 |     page,
  424 |   }) => {
  425 |     await page.setViewportSize({ width: 390, height: 844 });
  426 |     const fixture = await installArabicAiFixture(page);
  427 |     await installApiFixtures(page, { arabicAi: fixture });
  428 |     await programmaticSignIn(page);
  429 |     await page.goto(`${DASHBOARD_PATH}ai`);
  430 | 
  431 |     const composer = page.locator("textarea").first();
  432 |     await expect(composer).toBeVisible();
  433 |     const beforeOpen = await composer.boundingBox();
  434 |     expect(beforeOpen?.width).toBeGreaterThan(250);
  435 | 
  436 |     await page.getByRole("button", { name: "Open sessions" }).click();
  437 |     await expect(page.getByText("Sessions", { exact: true })).toBeVisible();
  438 |     const drawer = page.getByText("Sessions", { exact: true }).locator("..").locator("..");
  439 |     const drawerBox = await drawer.boundingBox();
  440 |     expect(drawerBox?.width).toBeLessThanOrEqual(390);
  441 |     const duringOpen = await composer.boundingBox();
  442 |     expect(duringOpen?.width).toBeGreaterThan(250);
  443 | 
> 444 |     await page.getByRole("button", { name: "Close sessions" }).click();
      |                                                                ^ Error: locator.click: Test timeout of 45000ms exceeded.
  445 |     await expect(page.getByRole("button", { name: "Open sessions" })).toBeVisible();
  446 |   });
  447 | 
  448 |   test("renders a user-visible API failure state", async ({ page }) => {
  449 |     await page.route("**/api/dashboard", (route) =>
  450 |       route.fulfill(
  451 |         jsonResponse({ error: "controlled dashboard outage" }, 503),
  452 |       ),
  453 |     );
  454 |     await programmaticSignIn(page);
  455 |     await expect(
  456 |       page.getByRole("heading", { name: "Failed to load dashboard" }),
  457 |     ).toBeVisible();
  458 |     await expect(
  459 |       page.getByRole("button", { name: "Retry Connection" }),
  460 |     ).toBeVisible();
  461 |   });
  462 | });
  463 | 
```