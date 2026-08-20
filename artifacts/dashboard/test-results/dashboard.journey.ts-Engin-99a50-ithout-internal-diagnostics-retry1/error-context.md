# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: dashboard.journey.ts >> EngineeringOS dashboard browser journey >> renders an Arabic source-backed AI answer without internal diagnostics
- Location: e2e/dashboard.journey.ts:394:3

# Error details

```
Error: expect(locator).toBeVisible() failed

Locator: getByText('ماذا يحدث عند انتهاء مهلة provider timeout داخل execution-tools.ts؟', { exact: true })
Expected: visible
Timeout: 10000ms
Error: element(s) not found

Call log:
  - Expect "toBeVisible" with timeout 10000ms
  - waiting for getByText('ماذا يحدث عند انتهاء مهلة provider timeout داخل execution-tools.ts؟', { exact: true })

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
  - text: EngineeringOS AI Llama 3.3 · Groq
  - paragraph: How can I help with your project?
  - paragraph: Ask about your codebase, tasks, metrics, or workflows. I have full context.
  - button "Analyze Scan"
  - button "Code Review"
  - button "Task Status"
  - button "Workflow Health"
  - button "Capability Probe"
  - textbox "Ask about your codebase, tasks, or metrics… (Enter to send)"
  - button [disabled]
- region "Notifications (F8)":
  - list
```

# Test source

```ts
  309 |     ...TEST_USER,
  310 |     ttl: 900,
  311 |     basePath: DASHBOARD_PATH,
  312 |   });
  313 |   await page.goto(signInUrl);
  314 |   await expect(page).toHaveURL(
  315 |     new RegExp(`${DASHBOARD_PATH.replaceAll("/", "\\/")}$`),
  316 |   );
  317 | }
  318 | 
  319 | async function openNavigation(page: Page, label: string, path: string) {
  320 |   await page.getByRole("link", { name: label, exact: true }).click();
  321 |   await expect(page).toHaveURL(new RegExp(`${path.replaceAll("/", "\\/")}$`));
  322 | }
  323 | 
  324 | test.describe("EngineeringOS dashboard browser journey", () => {
  325 |   test("signs in and traverses the authenticated operational shell", async ({
  326 |     page,
  327 |   }) => {
  328 |     await installApiFixtures(page);
  329 |     await programmaticSignIn(page);
  330 | 
  331 |     await expect(
  332 |       page.getByRole("heading", { name: "System Overview" }),
  333 |     ).toBeVisible();
  334 |     await expect(
  335 |       page.getByText("SYSTEM ONLINE", { exact: true }),
  336 |     ).toBeVisible();
  337 |     await expect(
  338 |       page.getByText("Smoke Project", { exact: true }).first(),
  339 |     ).toBeVisible();
  340 |     await expect(
  341 |       page.getByText("Dashboard API fixture ready", { exact: true }),
  342 |     ).toBeVisible();
  343 | 
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
> 409 |     await expect(page.getByText(fixture.question, { exact: true })).toBeVisible();
      |                                                                     ^ Error: expect(locator).toBeVisible() failed
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
  444 |     await page.getByRole("button", { name: "Close sessions" }).click();
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