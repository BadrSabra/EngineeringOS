# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: dashboard.journey.ts >> EngineeringOS dashboard browser journey >> renders an Arabic source-backed AI answer without internal diagnostics
- Location: e2e/dashboard.journey.ts:383:3

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
  298 |     ...TEST_USER,
  299 |     ttl: 900,
  300 |     basePath: DASHBOARD_PATH,
  301 |   });
  302 |   await page.goto(signInUrl);
  303 |   await expect(page).toHaveURL(
  304 |     new RegExp(`${DASHBOARD_PATH.replaceAll("/", "\\/")}$`),
  305 |   );
  306 | }
  307 | 
  308 | async function openNavigation(page: Page, label: string, path: string) {
  309 |   await page.getByRole("link", { name: label, exact: true }).click();
  310 |   await expect(page).toHaveURL(new RegExp(`${path.replaceAll("/", "\\/")}$`));
  311 | }
  312 | 
  313 | test.describe("EngineeringOS dashboard browser journey", () => {
  314 |   test("signs in and traverses the authenticated operational shell", async ({
  315 |     page,
  316 |   }) => {
  317 |     await installApiFixtures(page);
  318 |     await programmaticSignIn(page);
  319 | 
  320 |     await expect(
  321 |       page.getByRole("heading", { name: "System Overview" }),
  322 |     ).toBeVisible();
  323 |     await expect(
  324 |       page.getByText("SYSTEM ONLINE", { exact: true }),
  325 |     ).toBeVisible();
  326 |     await expect(
  327 |       page.getByText("Smoke Project", { exact: true }).first(),
  328 |     ).toBeVisible();
  329 |     await expect(
  330 |       page.getByText("Dashboard API fixture ready", { exact: true }),
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
  394 |     const sendButton = composer.locator("xpath=..").getByRole("button");
  395 |     await expect(sendButton).toBeEnabled();
  396 |     await sendButton.click();
  397 | 
> 398 |     await expect(page.getByText(fixture.question, { exact: true })).toBeVisible();
      |                                                                     ^ Error: expect(locator).toBeVisible() failed
  399 |     await expect(page.getByText(fixture.answer, { exact: true })).toBeVisible();
  400 |     await expect(page.getByText("Agent activity", { exact: false })).toBeVisible();
  401 |     await expect(page.getByText("Reading source", { exact: false })).toBeVisible();
  402 |     await expect(page.getByText(fixture.source, { exact: true })).toBeVisible();
  403 |     await expect(page.getByText(/claim-bound evidence excerpt retained/i)).toBeVisible();
  404 | 
  405 |     const visibleText = await page.locator("body").innerText();
  406 |     expect(visibleText).not.toMatch(/e2e-arabic-ai-session|e2e-execution|\/home\/runner|recovery diagnostics|rawPrompt|systemPrompt/i);
  407 |     expect(visibleText).not.toContain("تعذر عرض الاستجابة");
  408 |     expect(visibleText).toContain("تقريرًا جزئيًا");
  409 |   });
  410 | 
  411 |   test("keeps the AI session drawer overlaid on a phone viewport", async ({
  412 |     page,
  413 |   }) => {
  414 |     await page.setViewportSize({ width: 390, height: 844 });
  415 |     await installApiFixtures(page);
  416 |     await installArabicAiFixture(page);
  417 |     await programmaticSignIn(page);
  418 |     await page.goto(`${DASHBOARD_PATH}ai`);
  419 | 
  420 |     const composer = page.locator("textarea").first();
  421 |     await expect(composer).toBeVisible();
  422 |     const beforeOpen = await composer.boundingBox();
  423 |     expect(beforeOpen?.width).toBeGreaterThan(250);
  424 | 
  425 |     await page.getByRole("button", { name: "Open sessions" }).click();
  426 |     await expect(page.getByText("Sessions", { exact: true })).toBeVisible();
  427 |     const drawer = page.getByText("Sessions", { exact: true }).locator("..").locator("..");
  428 |     const drawerBox = await drawer.boundingBox();
  429 |     expect(drawerBox?.width).toBeLessThanOrEqual(390);
  430 |     const duringOpen = await composer.boundingBox();
  431 |     expect(duringOpen?.width).toBeGreaterThan(250);
  432 | 
  433 |     await page.getByRole("button", { name: "Close sessions" }).click();
  434 |     await expect(page.getByRole("button", { name: "Open sessions" })).toBeVisible();
  435 |   });
  436 | 
  437 |   test("renders a user-visible API failure state", async ({ page }) => {
  438 |     await page.route("**/api/dashboard", (route) =>
  439 |       route.fulfill(
  440 |         jsonResponse({ error: "controlled dashboard outage" }, 503),
  441 |       ),
  442 |     );
  443 |     await programmaticSignIn(page);
  444 |     await expect(
  445 |       page.getByRole("heading", { name: "Failed to load dashboard" }),
  446 |     ).toBeVisible();
  447 |     await expect(
  448 |       page.getByRole("button", { name: "Retry Connection" }),
  449 |     ).toBeVisible();
  450 |   });
  451 | });
  452 | 
```