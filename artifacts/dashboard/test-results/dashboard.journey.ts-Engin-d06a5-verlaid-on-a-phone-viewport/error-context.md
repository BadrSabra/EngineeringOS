# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: dashboard.journey.ts >> EngineeringOS dashboard browser journey >> keeps the AI session drawer overlaid on a phone viewport
- Location: e2e/dashboard.journey.ts:409:3

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
  331 |     ).toBeVisible();
  332 | 
  333 |     await openNavigation(page, "Projects", `${DASHBOARD_PATH}projects`);
  334 |     await expect(page.getByRole("heading", { name: "Projects" })).toBeVisible();
  335 |     await expect(
  336 |       page.getByText("Smoke Project", { exact: true }),
  337 |     ).toBeVisible();
  338 | 
  339 |     await openNavigation(page, "Event Stream", `${DASHBOARD_PATH}events`);
  340 |     await expect(
  341 |       page.getByRole("heading", { name: "Event Stream" }),
  342 |     ).toBeVisible();
  343 |     await expect(
  344 |       page.getByText("Dashboard API fixture ready", { exact: true }),
  345 |     ).toBeVisible();
  346 | 
  347 |     await openNavigation(page, "AI Assistant", `${DASHBOARD_PATH}ai`);
  348 |     await expect(page).not.toHaveURL(/sign-in/);
  349 |     await expect(
  350 |       page
  351 |         .getByText(
  352 |           /AI provider not configured|No AI key configured|AI Assistant/i,
  353 |         )
  354 |         .first(),
  355 |     ).toBeVisible();
  356 | 
  357 |     await openNavigation(
  358 |       page,
  359 |       "Mission Control",
  360 |       `${DASHBOARD_PATH}mission-control`,
  361 |     );
  362 |     await expect(
  363 |       page.getByRole("heading", { name: "No durable runs in the ledger" }),
  364 |     ).toBeVisible();
  365 | 
  366 |     await page.goto(`${DASHBOARD_PATH}flight-deck?executionId=${EXECUTION_ID}`);
  367 |     await expect(page).toHaveURL(
  368 |       new RegExp(
  369 |         `${DASHBOARD_PATH.replaceAll("/", "\\/")}flight-deck\\?executionId=`,
  370 |       ),
  371 |     );
  372 |     await expect(
  373 |       page.getByRole("heading", { name: "Audit / Chat run" }),
  374 |     ).toBeVisible();
  375 |     await expect(
  376 |       page.getByText("Controlled browser fixture completed.", { exact: true }),
  377 |     ).toBeVisible();
  378 |     await expect(
  379 |       page.getByText("PROVEN", { exact: true }).first(),
  380 |     ).toBeVisible();
  381 |   });
  382 | 
  383 |   test("renders an Arabic source-backed AI answer without internal diagnostics", async ({
  384 |     page,
  385 |   }) => {
  386 |     await installApiFixtures(page);
  387 |     const fixture = await installArabicAiFixture(page);
  388 |     await programmaticSignIn(page);
  389 |     await page.goto(`${DASHBOARD_PATH}ai`);
  390 | 
  391 |     const composer = page.locator("textarea").first();
  392 |     await expect(composer).toBeVisible();
  393 |     await composer.fill(fixture.question);
  394 |     await composer.press("Enter");
  395 | 
  396 |     await expect(page.getByText(fixture.question, { exact: true })).toBeVisible();
  397 |     await expect(page.getByText(fixture.answer, { exact: true })).toBeVisible();
  398 |     await expect(page.getByText("Agent activity", { exact: false })).toBeVisible();
  399 |     await expect(page.getByText("Reading source", { exact: false })).toBeVisible();
  400 |     await expect(page.getByText(fixture.source, { exact: true })).toBeVisible();
  401 |     await expect(page.getByText(/claim-bound evidence excerpt retained/i)).toBeVisible();
  402 | 
  403 |     const visibleText = await page.locator("body").innerText();
  404 |     expect(visibleText).not.toMatch(/e2e-arabic-ai-session|e2e-execution|\/home\/runner|recovery diagnostics|rawPrompt|systemPrompt/i);
  405 |     expect(visibleText).not.toContain("تعذر عرض الاستجابة");
  406 |     expect(visibleText).toContain("تقريرًا جزئيًا");
  407 |   });
  408 | 
  409 |   test("keeps the AI session drawer overlaid on a phone viewport", async ({
  410 |     page,
  411 |   }) => {
  412 |     await page.setViewportSize({ width: 390, height: 844 });
  413 |     await installApiFixtures(page);
  414 |     await installArabicAiFixture(page);
  415 |     await programmaticSignIn(page);
  416 |     await page.goto(`${DASHBOARD_PATH}ai`);
  417 | 
  418 |     const composer = page.locator("textarea").first();
  419 |     await expect(composer).toBeVisible();
  420 |     const beforeOpen = await composer.boundingBox();
  421 |     expect(beforeOpen?.width).toBeGreaterThan(250);
  422 | 
  423 |     await page.getByRole("button", { name: "Open sessions" }).click();
  424 |     await expect(page.getByText("Sessions", { exact: true })).toBeVisible();
  425 |     const drawer = page.getByText("Sessions", { exact: true }).locator("..").locator("..");
  426 |     const drawerBox = await drawer.boundingBox();
  427 |     expect(drawerBox?.width).toBeLessThanOrEqual(390);
  428 |     const duringOpen = await composer.boundingBox();
  429 |     expect(duringOpen?.width).toBeGreaterThan(250);
  430 | 
> 431 |     await page.getByRole("button", { name: "Close sessions" }).click();
      |                                                                ^ Error: locator.click: Test timeout of 45000ms exceeded.
  432 |     await expect(page.getByRole("button", { name: "Open sessions" })).toBeVisible();
  433 |   });
  434 | 
  435 |   test("renders a user-visible API failure state", async ({ page }) => {
  436 |     await page.route("**/api/dashboard", (route) =>
  437 |       route.fulfill(
  438 |         jsonResponse({ error: "controlled dashboard outage" }, 503),
  439 |       ),
  440 |     );
  441 |     await programmaticSignIn(page);
  442 |     await expect(
  443 |       page.getByRole("heading", { name: "Failed to load dashboard" }),
  444 |     ).toBeVisible();
  445 |     await expect(
  446 |       page.getByRole("button", { name: "Retry Connection" }),
  447 |     ).toBeVisible();
  448 |   });
  449 | });
  450 | 
```