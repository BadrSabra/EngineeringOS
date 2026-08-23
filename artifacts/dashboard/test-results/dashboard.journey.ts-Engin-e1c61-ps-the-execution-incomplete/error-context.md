# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: dashboard.journey.ts >> EngineeringOS dashboard browser journey >> resumes a failed analysis and keeps the execution incomplete
- Location: e2e/dashboard.journey.ts:2314:3

# Error details

```
Error: locator.click: Error: strict mode violation: getByRole('button', { name: 'Resume', exact: true }) resolved to 2 elements:
    1) <button type="button" data-component-name="Comp" data-replit-metadata="artifacts/dashboard/src/components/ui/button.tsx:54:6" class="inline-flex items-center justify-center gap-2 whitespace-nowrap font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0 hover-elevate active-elevate-2 border [border-color:var(--button-outline)] shadow-xs active:shadow…>…</button> aka getByLabel('Agent execution proof').getByRole('button', { name: 'Resume' })
    2) <button data-component-name="Comp" data-replit-metadata="artifacts/dashboard/src/components/ui/button.tsx:54:6" class="inline-flex items-center justify-center gap-2 whitespace-nowrap font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0 hover-elevate active-elevate-2 border [border-color:var(--button-outline)] shadow-xs active:shadow-none min-h-8 …>…</button> aka getByRole('button', { name: 'Resume' }).nth(1)

Call log:
  - waiting for getByRole('button', { name: 'Resume', exact: true })

```

```
Error: page.waitForRequest: Test ended.
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
          - generic [ref=f2e66]: EngineeringOS Dashboard Smoke
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
            - button "Verify the analysis evidence after reconnect." [ref=f2e106]
            - generic [ref=f2e109]:
              - generic [ref=f2e110]:
                - generic [ref=f2e111]:
                  - generic [ref=f2e116]: OpenRouter API Key
                  - generic [ref=f2e117]: Priority
                - paragraph [ref=f2e118]: Loading…
                - generic [ref=f2e119]:
                  - textbox "sk-or-…" [ref=f2e120]
                  - button "Save" [disabled]
              - generic [ref=f2e121]:
                - generic [ref=f2e122]:
                  - generic [ref=f2e127]: Gemini API Key
                  - generic [ref=f2e128]: Free · Priority
                - paragraph [ref=f2e129]: Loading…
                - generic [ref=f2e130]:
                  - textbox "AIza…" [ref=f2e131]
                  - button "Save" [ref=f2e132]
              - generic [ref=f2e133]:
                - generic [ref=f2e134]:
                  - generic [ref=f2e139]: DeepSeek API Key
                  - generic [ref=f2e140]: Optional
                - paragraph [ref=f2e141]: Loading…
                - generic [ref=f2e142]:
                  - textbox "sk-…" [ref=f2e143]
                  - button "Save" [disabled]
              - generic [ref=f2e144]:
                - generic [ref=f2e145]: Groq API Key
                - paragraph [ref=f2e151]: Loading…
                - generic [ref=f2e152]:
                  - textbox "gsk_…" [ref=f2e153]
                  - button "Save" [disabled]
          - generic [ref=f2e154]:
            - generic [ref=f2e155]:
              - generic [ref=f2e159]: EngineeringOS AI
              - generic [ref=f2e160]: Llama 3.3 · Groq
            - generic [ref=f2e164]:
              - generic "Agent execution proof" [ref=f2e165]:
                - generic [ref=f2e170]:
                  - generic [ref=f2e171]:
                    - generic [ref=f2e172]: Agent execution proof
                    - generic [ref=f2e173]: Preparing
                    - generic [ref=f2e174]: "Evidence: INCOMPLETE"
                    - generic [ref=f2e175]: Persisted proof
                    - button "Resume" [ref=f2e177]
                  - paragraph [ref=f2e178]: Execution paused — ready to resume from its durable checkpoint
                  - generic [ref=f2e179]:
                    - generic [ref=f2e180]:
                      - text: "Phase:"
                      - strong [ref=f2e181]: tool-execution
                    - generic [ref=f2e182]:
                      - text: "Attempt:"
                      - strong [ref=f2e183]: "0"
                    - generic [ref=f2e184]:
                      - text: "Revision:"
                      - code [ref=f2e185]: not recorded
                  - generic [ref=f2e186]:
                    - code [ref=f2e187]: Execution e2e-resumed-analysis-failure-execution
                    - link "Open execution in Flight Deck" [ref=f2e188] [cursor=pointer]:
                      - /url: /dashboard/flight-deck?executionId=e2e-resumed-analysis-failure-execution
                      - text: Flight Deck
                  - paragraph [ref=f2e193]: The required analysis did not complete.
                - generic [ref=f2e194]:
                  - generic [ref=f2e195]:
                    - generic [ref=f2e196]: Evidence
                    - generic [ref=f2e197]: Evidence pending
                  - generic [ref=f2e198]:
                    - generic [ref=f2e199]: Agent work
                    - generic [ref=f2e200]: 0/0 tools
                  - generic [ref=f2e201]:
                    - generic [ref=f2e202]: Delivery
                    - generic [ref=f2e203]: No writes applied automatically
                  - generic [ref=f2e204]:
                    - generic [ref=f2e205]: Safety
                    - generic [ref=f2e206]: No automatic writes
                - generic [ref=f2e207]:
                  - generic [ref=f2e208]:
                    - generic [ref=f2e209]: Objective
                    - generic [ref=f2e210]: Verify the analysis evidence after reconnect.
                  - generic [ref=f2e211]:
                    - generic [ref=f2e212]: Scope
                    - generic [ref=f2e213]: 0 files · 0 nodes
                  - generic [ref=f2e214]:
                    - generic [ref=f2e215]: Risk
                    - generic [ref=f2e216]: No unresolved patch risk recorded
                - generic [ref=f2e217]:
                  - generic [ref=f2e218]: checkpoint v1
                  - generic [ref=f2e219]: resume available
              - generic [ref=f2e220]: Verify the analysis evidence after reconnect.
              - generic [ref=f2e232]:
                - generic [ref=f2e233]:
                  - generic [ref=f2e234]: "ANALYSIS_INCOMPLETE: The required analysis did not complete, so no verified result is available."
                  - generic [ref=f2e235]:
                    - generic [ref=f2e236]: Execution failed
                    - generic [ref=f2e237]: Provider failure
                    - generic [ref=f2e238]: The required analysis did not complete.
                    - generic [ref=f2e239]: "Durable execution: e2e-resumed-analysis-failure-execution"
                - button "Forensic evidence INCOMPLETE" [ref=f2e241]:
                  - generic [ref=f2e244]: Forensic evidence
                  - generic [ref=f2e245]: INCOMPLETE
            - generic [ref=f2e248]:
              - generic [ref=f2e249]:
                - generic [ref=f2e250]:
                  - generic [ref=f2e251]: A saved AI execution is ready to resume
                  - generic [ref=f2e252]: Execution e2e-resu… · no file changes were applied automatically · checkpoint 1
                - button "Resume" [ref=f2e254]
              - generic [ref=f2e255]:
                - textbox "Ask about your codebase, tasks, or metrics… (Enter to send)" [ref=f2e256]
                - button [disabled]
  - region "Notifications (F8)":
    - list
```

# Test source

```ts
  2254 |     ).toBeVisible();
  2255 | 
  2256 |     const reloadedText = await page.locator("body").innerText();
  2257 |     await expectNoHorizontalOverflow(page);
  2258 |     expect(reloadedText).not.toMatch(
  2259 |       /raw exception|stack trace|\/home\/runner|secret|fixture diagnostic/i,
  2260 |     );
  2261 |   });
  2262 | 
  2263 |   test("preserves one partial answer after a provider disconnect and marks it incomplete", async ({
  2264 |     page,
  2265 |   }) => {
  2266 |     const fixture = await installArabicAiFixture(page);
  2267 |     await installApiFixtures(page, { arabicAi: fixture });
  2268 |     await programmaticSignIn(page);
  2269 |     await page.goto(`${DASHBOARD_PATH}ai`);
  2270 | 
  2271 |     const composer = page.locator("textarea").first();
  2272 |     await composer.fill(fixture.question);
  2273 |     await composer.locator("xpath=..").getByRole("button").click();
  2274 | 
  2275 |     const answer = page.getByText(fixture.answer, { exact: true });
  2276 |     await expect(answer).toHaveCount(1);
  2277 |     await expect(answer).toBeVisible();
  2278 |     await expect(page.getByText("INCOMPLETE:", { exact: false })).toBeVisible();
  2279 |     await expect(
  2280 |       page.getByText("provider failure", { exact: false }).last(),
  2281 |     ).toBeVisible();
  2282 |     await expect(
  2283 |       page.getByText("stopped: provider timeout", { exact: false }).last(),
  2284 |     ).toBeVisible();
  2285 |     await expect(
  2286 |       page.getByText("The provider disconnected after visible response text.", {
  2287 |         exact: true,
  2288 |       }),
  2289 |     ).toBeVisible();
  2290 | 
  2291 |     await page.reload();
  2292 |     await page
  2293 |       .getByRole("button", { name: fixture.question, exact: true })
  2294 |       .click();
  2295 | 
  2296 |     await expect(page.getByText(fixture.answer, { exact: true })).toHaveCount(
  2297 |       1,
  2298 |     );
  2299 |     await expect(page.getByText(fixture.answer, { exact: true })).toBeVisible();
  2300 |     await expect(page.getByText("INCOMPLETE:", { exact: false })).toBeVisible();
  2301 |     await expect(
  2302 |       page.getByText("provider failure", { exact: false }).last(),
  2303 |     ).toBeVisible();
  2304 |     await expect(
  2305 |       page.getByText("stopped: provider timeout", { exact: false }).last(),
  2306 |     ).toBeVisible();
  2307 |     await expect(
  2308 |       page.getByText("The provider disconnected after visible response text.", {
  2309 |         exact: true,
  2310 |       }),
  2311 |     ).toBeVisible();
  2312 |   });
  2313 | 
  2314 |   test("resumes a failed analysis and keeps the execution incomplete", async ({
  2315 |     page,
  2316 |   }) => {
  2317 |     const { fixture, execution } = installResumedAnalysisFailureFixture();
  2318 |     await installApiFixtures(page, {
  2319 |       arabicAi: fixture,
  2320 |       resumeFailure: { fixture, execution },
  2321 |     });
  2322 |     await programmaticSignIn(page);
  2323 | 
  2324 |     await page.evaluate(
  2325 |       ({ sessionId, executionId, projectId, resumeToken, message }) => {
  2326 |         localStorage.setItem(
  2327 |           `eos_ai_execution_current_${projectId}`,
  2328 |           sessionId,
  2329 |         );
  2330 |         localStorage.setItem(
  2331 |           `eos_ai_execution_${projectId}_${sessionId}`,
  2332 |           JSON.stringify({
  2333 |             id: executionId,
  2334 |             projectId,
  2335 |             sessionId,
  2336 |             resumeToken,
  2337 |             message,
  2338 |           }),
  2339 |         );
  2340 |       },
  2341 |       {
  2342 |         sessionId: fixture.sessionId,
  2343 |         executionId: fixture.executionId,
  2344 |         projectId: "e2e-project",
  2345 |         resumeToken: "e2e-resumed-analysis-failure-token-opaque",
  2346 |         message: fixture.question,
  2347 |       },
  2348 |     );
  2349 |     await page.goto(`${DASHBOARD_PATH}ai`);
  2350 | 
  2351 |     await expect(
  2352 |       page.getByText("A saved AI execution is ready to resume"),
  2353 |     ).toBeVisible();
> 2354 |     const resumeRequest = page.waitForRequest(
       |                                ^ Error: page.waitForRequest: Test ended.
  2355 |       (request) =>
  2356 |         request.url().includes("/api/ai/chat/stream") &&
  2357 |         request.method() === "POST",
  2358 |     );
  2359 |     await page.getByRole("button", { name: "Resume", exact: true }).click();
  2360 |     const requestBody = JSON.parse(
  2361 |       (await resumeRequest).postData() ?? "{}",
  2362 |     ) as Record<string, unknown>;
  2363 |     expect(requestBody).toEqual(
  2364 |       expect.objectContaining({
  2365 |         projectId: "e2e-project",
  2366 |         sessionId: fixture.sessionId,
  2367 |         executionId: fixture.executionId,
  2368 |         resumeToken: "e2e-resumed-analysis-failure-token-opaque",
  2369 |         message: fixture.question,
  2370 |       }),
  2371 |     );
  2372 | 
  2373 |     await expect(
  2374 |       page.getByText("Failed to send message", { exact: true }),
  2375 |     ).toBeVisible();
  2376 |     await expect(
  2377 |       page.getByText("A saved AI execution is ready to resume"),
  2378 |     ).toBeVisible();
  2379 |     const visibleText = await page.locator("body").innerText();
  2380 |     expect(visibleText).not.toContain("COMPLETED");
  2381 |     expect(visibleText).not.toContain("Persisted execution proof");
  2382 |     expect(visibleText).toContain("The required analysis did not complete.");
  2383 |   });
  2384 | 
  2385 |   test("recovers a missing token after a real stream abort and resumes one execution", async ({
  2386 |     page,
  2387 |   }) => {
  2388 |     const recovery = installInterruptedResumeFixture();
  2389 |     await installApiFixtures(page, { interruptedResume: recovery });
  2390 |     await page.addInitScript(() => {
  2391 |       const nativeFetch = window.fetch.bind(window);
  2392 |       window.fetch = async (input, init) => {
  2393 |         const url =
  2394 |           typeof input === "string"
  2395 |             ? input
  2396 |             : input instanceof Request
  2397 |               ? input.url
  2398 |               : String(input);
  2399 |         const body = typeof init?.body === "string" ? init.body : "";
  2400 |         if (
  2401 |           !url.includes("/api/ai/chat/stream") ||
  2402 |           body.includes('"executionId"')
  2403 |         ) {
  2404 |           return nativeFetch(input, init);
  2405 |         }
  2406 | 
  2407 |         const response = await nativeFetch(input, init);
  2408 |         if (!response.body) return response;
  2409 |         const reader = response.body.getReader();
  2410 |         const encoder = new TextEncoder();
  2411 |         const stream = new ReadableStream({
  2412 |           async start(controller) {
  2413 |             let buffered = "";
  2414 |             while (true) {
  2415 |               const { done, value } = await reader.read();
  2416 |               if (done) {
  2417 |                 if (buffered) controller.enqueue(encoder.encode(buffered));
  2418 |                 controller.close();
  2419 |                 return;
  2420 |               }
  2421 |               buffered += new TextDecoder().decode(value, { stream: true });
  2422 |               const marker = buffered.indexOf('"type":"execution_started"');
  2423 |               const frameEnd =
  2424 |                 marker < 0 ? -1 : buffered.indexOf("\n\n", marker);
  2425 |               if (frameEnd >= 0) {
  2426 |                 controller.enqueue(
  2427 |                   encoder.encode(buffered.slice(0, frameEnd + 2)),
  2428 |                 );
  2429 |                 controller.error(new TypeError("network connection reset"));
  2430 |                 return;
  2431 |               }
  2432 |             }
  2433 |           },
  2434 |         });
  2435 |         return new Response(stream, {
  2436 |           status: response.status,
  2437 |           statusText: response.statusText,
  2438 |           headers: response.headers,
  2439 |         });
  2440 |       };
  2441 |     });
  2442 |     await programmaticSignIn(page);
  2443 |     await page.goto(`${DASHBOARD_PATH}ai`);
  2444 | 
  2445 |     const streamRequests: Array<Record<string, unknown>> = [];
  2446 |     page.on("request", (request) => {
  2447 |       if (
  2448 |         request.url().includes("/api/ai/chat/stream") &&
  2449 |         request.method() === "POST"
  2450 |       ) {
  2451 |         try {
  2452 |           streamRequests.push(
  2453 |             request.postDataJSON() as Record<string, unknown>,
  2454 |           );
```