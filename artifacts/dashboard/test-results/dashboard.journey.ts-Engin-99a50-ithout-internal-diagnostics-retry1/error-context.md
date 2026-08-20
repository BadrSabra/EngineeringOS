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

Locator: getByText('عند انتهاء مهلة مزود الذكاء الاصطناعي، يعيد المسار تقريرًا جزئيًا من الأدلة التي جُمعت بدل إصدار Finding غير مثبت.', { exact: true })
Expected: visible
Error: strict mode violation: getByText('عند انتهاء مهلة مزود الذكاء الاصطناعي، يعيد المسار تقريرًا جزئيًا من الأدلة التي جُمعت بدل إصدار Finding غير مثبت.', { exact: true }) resolved to 2 elements:
    1) <p class="mb-2 last:mb-0">عند انتهاء مهلة مزود الذكاء الاصطناعي، يعيد المسا…</p> aka getByText('عند انتهاء مهلة مزود الذكاء الاصطناعي، يعيد المسار تقريرًا جزئيًا من الأدلة التي').first()
    2) <p class="text-[12px] leading-relaxed text-foreground/90">عند انتهاء مهلة مزود الذكاء الاصطناعي، يعيد المسا…</p> aka getByText('عند انتهاء مهلة مزود الذكاء الاصطناعي، يعيد المسار تقريرًا جزئيًا من الأدلة التي').nth(1)

Call log:
  - Expect "toBeVisible" with timeout 10000ms
  - waiting for getByText('عند انتهاء مهلة مزود الذكاء الاصطناعي، يعيد المسار تقريرًا جزئيًا من الأدلة التي جُمعت بدل إصدار Finding غير مثبت.', { exact: true })

```

# Page snapshot

```yaml
- generic [ref=f2e2]:
  - generic [ref=f2e3]:
    - generic [ref=f2e4]:
      - generic [ref=f2e5]: EngineeringOS
      - generic [ref=f2e13]:
        - generic [ref=f2e14]: Core Ops
        - link "Dashboard" [ref=f2e15] [cursor=pointer]:
          - /url: /dashboard/
        - link "Projects" [ref=f2e21] [cursor=pointer]:
          - /url: /dashboard/projects
        - link "Tasks" [ref=f2e27] [cursor=pointer]:
          - /url: /dashboard/tasks
        - link "Rules Engine" [ref=f2e31] [cursor=pointer]:
          - /url: /dashboard/rules
        - link "Workflows" [ref=f2e34] [cursor=pointer]:
          - /url: /dashboard/workflows
        - link "Event Stream" [ref=f2e39] [cursor=pointer]:
          - /url: /dashboard/events
        - link "Metrics" [ref=f2e42] [cursor=pointer]:
          - /url: /dashboard/metrics
        - link "Knowledge Graph" [ref=f2e45] [cursor=pointer]:
          - /url: /dashboard/graph
        - link "AI Assistant" [ref=f2e51] [cursor=pointer]:
          - /url: /dashboard/ai
        - link "Flight Deck" [ref=f2e55] [cursor=pointer]:
          - /url: /dashboard/flight-deck
        - link "Mission Control" [ref=f2e58] [cursor=pointer]:
          - /url: /dashboard/mission-control
      - generic [ref=f2e63]:
        - generic [ref=f2e64]: ED
        - generic [ref=f2e65]:
          - generic [ref=f2e66]: EngineeringOS Dashboard Release
          - generic [ref=f2e67]: Connected
        - button "Sign out" [ref=f2e69]
    - generic [ref=f2e73]:
      - banner [ref=f2e74]:
        - textbox "Search projects, tasks, rules... (Press '/')" [ref=f2e79]
        - generic [ref=f2e80]:
          - generic [ref=f2e81]: v1.0.4-stable
          - button [ref=f2e86]
      - main [ref=f2e91]:
        - generic [ref=f2e93]:
          - generic [ref=f2e94]:
            - generic [ref=f2e95]:
              - generic [ref=f2e96]: Sessions
              - button "New session" [ref=f2e98]
            - combobox [ref=f2e101]:
              - option "Smoke Project" [selected]
            - button "ماذا يحدث عند انتهاء مهلة provider timeout داخل execution-tools.ts؟" [ref=f2e106]
            - generic [ref=f2e109]:
              - generic [ref=f2e110]:
                - generic [ref=f2e111]:
                  - generic [ref=f2e116]: OpenRouter API Key
                  - generic [ref=f2e117]: Priority
                - paragraph [ref=f2e118]: Get a free key at openrouter.ai/keys — routes to 300+ models, used first when configured.
                - generic [ref=f2e119]:
                  - textbox "sk-or-…" [ref=f2e120]
                  - button "Save" [disabled]
              - generic [ref=f2e121]:
                - generic [ref=f2e122]:
                  - generic [ref=f2e127]: Gemini API Key
                  - generic [ref=f2e128]: Free · Priority
                - paragraph [ref=f2e129]: Free key at aistudio.google.com/apikey — 1,500 req/day, 1M tokens/day.
                - generic [ref=f2e130]:
                  - textbox "AIza…" [ref=f2e131]
                  - button "Save" [ref=f2e132]
              - generic [ref=f2e133]:
                - generic [ref=f2e134]:
                  - generic [ref=f2e139]: DeepSeek API Key
                  - generic [ref=f2e140]: Optional
                - paragraph [ref=f2e141]: Get a free API key at platform.deepseek.com to use DeepSeek as your AI provider.
                - generic [ref=f2e142]:
                  - textbox "sk-…" [ref=f2e143]
                  - button "Save" [disabled]
              - generic [ref=f2e144]:
                - generic [ref=f2e145]: Groq API Key
                - paragraph [ref=f2e151]: No personal key saved — the server's key will be used if one is configured.
                - generic [ref=f2e152]:
                  - textbox "gsk_…" [ref=f2e153]
                  - button "Save" [disabled]
          - generic [ref=f2e154]:
            - generic [ref=f2e155]:
              - generic [ref=f2e159]: EngineeringOS AI
              - generic [ref=f2e160]: Llama 3.3 · Groq
            - generic [ref=f2e164]:
              - generic [ref=f2e165]: ماذا يحدث عند انتهاء مهلة provider timeout داخل execution-tools.ts؟
              - generic [ref=f2e177]:
                - paragraph [ref=f2e179]: عند انتهاء مهلة مزود الذكاء الاصطناعي، يعيد المسار تقريرًا جزئيًا من الأدلة التي جُمعت بدل إصدار Finding غير مثبت.
                - generic [ref=f2e180]:
                  - generic [ref=f2e181]: Behavior evidence · 1 excerpt
                  - generic [ref=f2e190]:
                    - generic [ref=f2e191]: return partialFromCollectedEvidence("provider timeout");
                    - generic [ref=f2e192]:
                      - button "src/execution-tools.ts:42" [ref=f2e193]
                      - button "View file" [ref=f2e201]
                - generic [ref=f2e205]:
                  - generic [ref=f2e206]:
                    - generic [ref=f2e212]: Behavior answer
                    - generic [ref=f2e213]: confidence 100%
                  - paragraph [ref=f2e214]: عند انتهاء مهلة مزود الذكاء الاصطناعي، يعيد المسار تقريرًا جزئيًا من الأدلة التي جُمعت بدل إصدار Finding غير مثبت.
                  - generic [ref=f2e215]: src/execution-tools.ts
                  - generic [ref=f2e217]: "Answered fields: timeout behavior"
                  - generic [ref=f2e218]:
                    - generic [ref=f2e219]: Behavior evidence · 1 excerpt
                    - generic [ref=f2e228]:
                      - generic [ref=f2e229]: return partialFromCollectedEvidence("provider timeout");
                      - generic [ref=f2e230]:
                        - button "src/execution-tools.ts:42" [ref=f2e231]
                        - button "View file" [ref=f2e239]
                - group [ref=f2e243]:
                  - generic "Agent activity · 1 events" [ref=f2e244] [cursor=pointer]:
                    - generic [ref=f2e247]: Agent activity
                    - generic [ref=f2e248]: · 1 events
            - generic [ref=f2e252]:
              - textbox "Ask about your codebase, tasks, or metrics… (Enter to send)" [ref=f2e253]
              - button [disabled]
  - region "Notifications (F8)":
    - list
```

# Test source

```ts
  321 |     new RegExp(`${DASHBOARD_PATH.replaceAll("/", "\\/")}$`),
  322 |   );
  323 | }
  324 | 
  325 | async function openNavigation(page: Page, label: string, path: string) {
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
> 421 |     await expect(page.getByText(fixture.answer, { exact: true })).toBeVisible();
      |                                                                   ^ Error: expect(locator).toBeVisible() failed
  422 |     await expect(page.getByText("Agent activity", { exact: false })).toBeVisible();
  423 |     await expect(page.getByText("Reading source", { exact: false })).toBeVisible();
  424 |     await expect(page.getByText(fixture.source, { exact: true })).toBeVisible();
  425 |     await expect(page.getByText(/claim-bound evidence excerpt retained/i)).toBeVisible();
  426 | 
  427 |     const visibleText = await page.locator("body").innerText();
  428 |     expect(visibleText).not.toMatch(/e2e-arabic-ai-session|e2e-execution|\/home\/runner|recovery diagnostics|rawPrompt|systemPrompt/i);
  429 |     expect(visibleText).not.toContain("تعذر عرض الاستجابة");
  430 |     expect(visibleText).toContain("تقريرًا جزئيًا");
  431 |   });
  432 | 
  433 |   test("keeps the AI session drawer overlaid on a phone viewport", async ({
  434 |     page,
  435 |   }) => {
  436 |     await page.setViewportSize({ width: 390, height: 844 });
  437 |     const fixture = await installArabicAiFixture(page);
  438 |     await installApiFixtures(page, { arabicAi: fixture });
  439 |     await programmaticSignIn(page);
  440 |     await page.goto(`${DASHBOARD_PATH}ai`);
  441 | 
  442 |     const composer = page.locator("textarea").first();
  443 |     await expect(composer).toBeVisible();
  444 |     const beforeOpen = await composer.boundingBox();
  445 |     expect(beforeOpen?.width).toBeGreaterThan(250);
  446 | 
  447 |     await page.getByRole("button", { name: "Open sessions" }).click();
  448 |     await expect(page.getByText("Sessions", { exact: true })).toBeVisible();
  449 |     const drawer = page.getByText("Sessions", { exact: true }).locator("..").locator("..");
  450 |     const drawerBox = await drawer.boundingBox();
  451 |     expect(drawerBox?.width).toBeLessThanOrEqual(390);
  452 |     const duringOpen = await composer.boundingBox();
  453 |     expect(duringOpen?.width).toBeGreaterThan(250);
  454 | 
  455 |     await page.getByRole("button", { name: "Close sidebar" }).click();
  456 |     await expect(page.getByRole("button", { name: "Open sessions" })).toBeVisible();
  457 |   });
  458 | 
  459 |   test("renders a user-visible API failure state", async ({ page }) => {
  460 |     await page.route("**/api/dashboard", (route) =>
  461 |       route.fulfill(
  462 |         jsonResponse({ error: "controlled dashboard outage" }, 503),
  463 |       ),
  464 |     );
  465 |     await programmaticSignIn(page);
  466 |     await expect(
  467 |       page.getByRole("heading", { name: "Failed to load dashboard" }),
  468 |     ).toBeVisible();
  469 |     await expect(
  470 |       page.getByRole("button", { name: "Retry Connection" }),
  471 |     ).toBeVisible();
  472 |   });
  473 | });
  474 | 
```