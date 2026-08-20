# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: dashboard.journey.ts >> EngineeringOS dashboard browser journey >> renders an Arabic source-backed AI answer without internal diagnostics
- Location: e2e/dashboard.journey.ts:400:3

# Error details

```
Error: expect(locator).toBeVisible() failed

Locator: getByText(/claim-bound evidence excerpt retained/i)
Expected: visible
Timeout: 10000ms
Error: element(s) not found

Call log:
  - Expect "toBeVisible" with timeout 10000ms
  - waiting for getByText(/claim-bound evidence excerpt retained/i)

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
- text: ED EngineeringOS Dashboard Release Connected
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
  - text: Behavior evidence · 1 excerpt return partialFromCollectedEvidence("provider timeout");
  - button "src/execution-tools.ts:42"
  - button "View file"
  - text: Behavior answer confidence 100%
  - paragraph: عند انتهاء مهلة مزود الذكاء الاصطناعي، يعيد المسار تقريرًا جزئيًا من الأدلة التي جُمعت بدل إصدار Finding غير مثبت.
  - text: "src/execution-tools.ts Answered fields: timeout behavior Behavior evidence · 1 excerpt return partialFromCollectedEvidence(\"provider timeout\");"
  - button "src/execution-tools.ts:42"
  - button "View file"
  - group:
    - text: Agent activity · 1 events ✓ Reading source · src/execution-tools.ts
    - code: src/execution-tools.ts
  - textbox "Ask about your codebase, tasks, or metrics… (Enter to send)"
  - button [disabled]
- region "Notifications (F8)":
  - list
```

# Test source

```ts
  326 |   await page.getByRole("link", { name: label, exact: true }).click();
  327 |   await expect(page).toHaveURL(new RegExp(`${path.replaceAll("/", "\\/")}$`));
  328 | }
  329 | 
  330 | test.describe("EngineeringOS dashboard browser journey", () => {
  331 |   test("signs in and traverses the authenticated operational shell", async ({
  332 |     page,
  333 |   }) => {
  334 |     await installApiFixtures(page);
  335 |     await programmaticSignIn(page);
  336 | 
  337 |     await expect(
  338 |       page.getByRole("heading", { name: "System Overview" }),
  339 |     ).toBeVisible();
  340 |     await expect(
  341 |       page.getByText("SYSTEM ONLINE", { exact: true }),
  342 |     ).toBeVisible();
  343 |     await expect(
  344 |       page.getByText("Smoke Project", { exact: true }).first(),
  345 |     ).toBeVisible();
  346 |     await expect(
  347 |       page.getByText("Dashboard API fixture ready", { exact: true }),
  348 |     ).toBeVisible();
  349 | 
  350 |     await openNavigation(page, "Projects", `${DASHBOARD_PATH}projects`);
  351 |     await expect(page.getByRole("heading", { name: "Projects" })).toBeVisible();
  352 |     await expect(
  353 |       page.getByText("Smoke Project", { exact: true }),
  354 |     ).toBeVisible();
  355 | 
  356 |     await openNavigation(page, "Event Stream", `${DASHBOARD_PATH}events`);
  357 |     await expect(
  358 |       page.getByRole("heading", { name: "Event Stream" }),
  359 |     ).toBeVisible();
  360 |     await expect(
  361 |       page.getByText("Dashboard API fixture ready", { exact: true }),
  362 |     ).toBeVisible();
  363 | 
  364 |     await openNavigation(page, "AI Assistant", `${DASHBOARD_PATH}ai`);
  365 |     await expect(page).not.toHaveURL(/sign-in/);
  366 |     await expect(
  367 |       page
  368 |         .getByText(
  369 |           /AI provider not configured|No AI key configured|AI Assistant/i,
  370 |         )
  371 |         .first(),
  372 |     ).toBeVisible();
  373 | 
  374 |     await openNavigation(
  375 |       page,
  376 |       "Mission Control",
  377 |       `${DASHBOARD_PATH}mission-control`,
  378 |     );
  379 |     await expect(
  380 |       page.getByRole("heading", { name: "No durable runs in the ledger" }),
  381 |     ).toBeVisible();
  382 | 
  383 |     await page.goto(`${DASHBOARD_PATH}flight-deck?executionId=${EXECUTION_ID}`);
  384 |     await expect(page).toHaveURL(
  385 |       new RegExp(
  386 |         `${DASHBOARD_PATH.replaceAll("/", "\\/")}flight-deck\\?executionId=`,
  387 |       ),
  388 |     );
  389 |     await expect(
  390 |       page.getByRole("heading", { name: "Audit / Chat run" }),
  391 |     ).toBeVisible();
  392 |     await expect(
  393 |       page.getByText("Controlled browser fixture completed.", { exact: true }),
  394 |     ).toBeVisible();
  395 |     await expect(
  396 |       page.getByText("PROVEN", { exact: true }).first(),
  397 |     ).toBeVisible();
  398 |   });
  399 | 
  400 |   test("renders an Arabic source-backed AI answer without internal diagnostics", async ({
  401 |     page,
  402 |   }) => {
  403 |     const fixture = await installArabicAiFixture(page);
  404 |     await installApiFixtures(page, { arabicAi: fixture });
  405 |     await programmaticSignIn(page);
  406 |     await page.goto(`${DASHBOARD_PATH}ai`);
  407 | 
  408 |     const composer = page.locator("textarea").first();
  409 |     await expect(composer).toBeVisible();
  410 |     await composer.fill(fixture.question);
  411 |     const sendButton = composer.locator("xpath=..").getByRole("button");
  412 |     await expect(sendButton).toBeEnabled();
  413 |     const streamResponsePromise = page.waitForResponse((response) =>
  414 |       response.url().includes("/api/ai/chat/stream"),
  415 |     );
  416 |     await sendButton.click();
  417 |     const streamResponse = await streamResponsePromise;
  418 |     expect(streamResponse.status()).toBe(200);
  419 | 
  420 |     await expect(page.getByText(fixture.question, { exact: true }).last()).toBeVisible();
  421 |     await expect(page.getByText(fixture.answer, { exact: true }).last()).toBeVisible();
  422 |     await expect(page.getByText("Agent activity", { exact: false })).toBeVisible();
  423 |     await page.locator("summary").filter({ hasText: "Agent activity" }).click();
  424 |     await expect(page.getByText("Reading source", { exact: false })).toBeVisible();
  425 |     await expect(page.getByText(fixture.source, { exact: true }).last()).toBeVisible();
> 426 |     await expect(page.getByText(/claim-bound evidence excerpt retained/i)).toBeVisible();
      |                                                                            ^ Error: expect(locator).toBeVisible() failed
  427 | 
  428 |     const visibleText = await page.locator("body").innerText();
  429 |     expect(visibleText).not.toMatch(/e2e-arabic-ai-session|e2e-execution|\/home\/runner|recovery diagnostics|rawPrompt|systemPrompt/i);
  430 |     expect(visibleText).not.toContain("تعذر عرض الاستجابة");
  431 |     expect(visibleText).toContain("تقريرًا جزئيًا");
  432 |   });
  433 | 
  434 |   test("keeps the AI session drawer overlaid on a phone viewport", async ({
  435 |     page,
  436 |   }) => {
  437 |     await page.setViewportSize({ width: 390, height: 844 });
  438 |     const fixture = await installArabicAiFixture(page);
  439 |     await installApiFixtures(page, { arabicAi: fixture });
  440 |     await programmaticSignIn(page);
  441 |     await page.goto(`${DASHBOARD_PATH}ai`);
  442 | 
  443 |     const composer = page.locator("textarea").first();
  444 |     await expect(composer).toBeVisible();
  445 |     const beforeOpen = await composer.boundingBox();
  446 |     expect(beforeOpen?.width).toBeGreaterThan(250);
  447 | 
  448 |     await page.getByRole("button", { name: "Open sessions" }).click();
  449 |     await expect(page.getByText("Sessions", { exact: true })).toBeVisible();
  450 |     const drawer = page.getByText("Sessions", { exact: true }).locator("..").locator("..");
  451 |     const drawerBox = await drawer.boundingBox();
  452 |     expect(drawerBox?.width).toBeLessThanOrEqual(390);
  453 |     const duringOpen = await composer.boundingBox();
  454 |     expect(duringOpen?.width).toBeGreaterThan(250);
  455 | 
  456 |     await page.getByRole("button", { name: "Close sidebar" }).click();
  457 |     await expect(page.getByRole("button", { name: "Open sessions" })).toBeVisible();
  458 |   });
  459 | 
  460 |   test("renders a user-visible API failure state", async ({ page }) => {
  461 |     await page.route("**/api/dashboard", (route) =>
  462 |       route.fulfill(
  463 |         jsonResponse({ error: "controlled dashboard outage" }, 503),
  464 |       ),
  465 |     );
  466 |     await programmaticSignIn(page);
  467 |     await expect(
  468 |       page.getByRole("heading", { name: "Failed to load dashboard" }),
  469 |     ).toBeVisible();
  470 |     await expect(
  471 |       page.getByRole("button", { name: "Retry Connection" }),
  472 |     ).toBeVisible();
  473 |   });
  474 | });
  475 | 
```