# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: dashboard.journey.ts >> EngineeringOS dashboard browser journey >> keeps safe citation state across browser back and forward navigation with blocked evidence
- Location: e2e/dashboard.journey.ts:2285:3

# Error details

```
ReferenceError: fixture is not defined
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
            - combobox [ref=f2e101]
            - generic [ref=f2e106]:
              - generic [ref=f2e107]:
                - generic [ref=f2e108]:
                  - generic [ref=f2e113]: OpenRouter API Key
                  - generic [ref=f2e114]: Priority
                - paragraph [ref=f2e115]: Loading…
                - generic [ref=f2e116]:
                  - textbox "sk-or-…" [ref=f2e117]
                  - button "Save" [disabled]
              - generic [ref=f2e118]:
                - generic [ref=f2e119]:
                  - generic [ref=f2e124]: Gemini API Key
                  - generic [ref=f2e125]: Free · Priority
                - paragraph [ref=f2e126]: Loading…
                - generic [ref=f2e127]:
                  - textbox "AIza…" [ref=f2e128]
                  - button "Save" [ref=f2e129]
              - generic [ref=f2e130]:
                - generic [ref=f2e131]:
                  - generic [ref=f2e136]: DeepSeek API Key
                  - generic [ref=f2e137]: Optional
                - paragraph [ref=f2e138]: Loading…
                - generic [ref=f2e139]:
                  - textbox "sk-…" [ref=f2e140]
                  - button "Save" [disabled]
              - generic [ref=f2e141]:
                - generic [ref=f2e142]: Groq API Key
                - paragraph [ref=f2e148]: Loading…
                - generic [ref=f2e149]:
                  - textbox "gsk_…" [ref=f2e150]
                  - button "Save" [disabled]
          - generic [ref=f2e151]:
            - generic [ref=f2e152]:
              - generic [ref=f2e156]: EngineeringOS AI
              - generic [ref=f2e157]: Llama 3.3 · Groq
            - generic [ref=f2e161]:
              - generic [ref=f2e162]:
                - paragraph [ref=f2e167]: How can I help with your project?
                - paragraph [ref=f2e168]: Loading your projects…
              - generic [ref=f2e169]:
                - button "Analyze Scan" [disabled] [ref=f2e170]
                - button "Code Review" [disabled] [ref=f2e174]
                - button "Task Status" [disabled] [ref=f2e179]
                - button "Workflow Health" [disabled] [ref=f2e182]
                - button "Capability Probe" [disabled] [ref=f2e187]
            - generic [ref=f2e191]:
              - textbox "Loading your projects…" [disabled] [ref=f2e192]
              - button "Loading your projects…" [disabled]
  - region "Notifications (F8)":
    - list
```

# Test source

```ts
  2205 |     ).toBeVisible();
  2206 |     await expect(
  2207 |       page.getByText("Agent activity", { exact: false }),
  2208 |     ).toBeVisible();
  2209 |     await page.locator("summary").filter({ hasText: "Agent activity" }).click();
  2210 |     await expect(
  2211 |       page.getByText("Reading source", { exact: false }),
  2212 |     ).toBeVisible();
  2213 |     await expect(
  2214 |       page.getByText(fixture.source, { exact: true }).last(),
  2215 |     ).toBeVisible();
  2216 |     await expect(
  2217 |       page.getByText(/Behavior evidence · 1 excerpt/i).last(),
  2218 |     ).toBeVisible();
  2219 |     await expect(
  2220 |       page
  2221 |         .getByText('return partialFromCollectedEvidence("provider timeout");', {
  2222 |           exact: true,
  2223 |         })
  2224 |         .last(),
  2225 |     ).toBeVisible();
  2226 | 
  2227 |     const visibleText = await page.locator("body").innerText();
  2228 |     expect(visibleText).not.toContain("COMPLETED");
  2229 |     expect(visibleText).not.toContain("Persisted execution proof");
  2230 |     expect(visibleText).toContain("The required analysis did not complete.");
  2231 |   });
  2232 | 
  2233 |   test("keeps the AI session drawer overlaid on a phone viewport with accepted evidence", async ({
  2234 |     page,
  2235 |   }) => {
  2236 |     await page.setViewportSize({ width: 390, height: 844 });
  2237 |     const fixture = await installArabicAiFixture(page);
  2238 |     await installApiFixtures(page, { arabicAi: fixture });
  2239 |     await programmaticSignIn(page);
  2240 |     await page.goto(`${DASHBOARD_PATH}ai`);
  2241 | 
  2242 |     const composer = page.locator("textarea").first();
  2243 |     await composer.fill(fixture.question);
  2244 |     await composer.locator("xpath=..").getByRole("button").click();
  2245 | 
  2246 |     await expect(
  2247 |       page.getByText(fixture.answer, { exact: true }).last(),
  2248 |     ).toBeVisible();
  2249 |     await expect(
  2250 |       page
  2251 |         .getByText("required tool did not complete — BLOCKED/INCOMPLETE", {
  2252 |           exact: false,
  2253 |         })
  2254 |         .last(),
  2255 |     ).toBeVisible();
  2256 |     await page
  2257 |       .locator("summary")
  2258 |       .filter({ hasText: "Agent activity" })
  2259 |       .last()
  2260 |       .click();
  2261 |     await expect(page.locator("body")).toContainText("Reading source");
  2262 |     await expect(page.locator("body")).toContainText(
  2263 |       "src/missing-release-fixture.ts",
  2264 |     );
  2265 |     await expect(page.locator("body")).toContainText("Tool failed");
  2266 |     await expect(page.locator("body")).toContainText("TOOL_EXECUTION_FAILED");
  2267 |     await page
  2268 |       .locator("summary")
  2269 |       .filter({ hasText: "Persisted execution proof" })
  2270 |       .last()
  2271 |       .click();
  2272 |     await expect(
  2273 |       page
  2274 |         .getByText("required tool failed — operation blocked", { exact: true })
  2275 |         .last(),
  2276 |     ).toBeVisible();
  2277 |     await expectNoHorizontalOverflow(page);
  2278 | 
  2279 |     const visibleText = await page.locator("body").innerText();
  2280 |     expect(visibleText).not.toMatch(
  2281 |       /rawPrompt|systemPrompt|provider diagnostics|source-window|recovery prompt|\/home\/runner/i,
  2282 |     );
  2283 |   });
  2284 | 
  2285 |   test("keeps safe citation state across browser back and forward navigation with blocked evidence", async ({
  2286 |     page,
  2287 |   }) => {
  2288 |     const accepted = await installArabicAiFixture(page, {
  2289 |       sessionId: "e2e-history-accepted-session",
  2290 |       question: "ما هو سلوك مهلة provider عند الرجوع عبر سجل المتصفح؟",
  2291 |     });
  2292 |     const blocked = await installArabicAiFixture(page, {
  2293 |       blocked: true,
  2294 |       sessionId: "e2e-history-blocked-session",
  2295 |       question: "ما هو الدليل المحجوب عند الرجوع عبر سجل المتصفح؟",
  2296 |     });
  2297 |     await installApiFixtures(page, {
  2298 |       arabicAi: accepted,
  2299 |       alternateAi: blocked,
  2300 |     });
  2301 |     await programmaticSignIn(page);
  2302 |     await page.goto(`${DASHBOARD_PATH}ai`);
  2303 | 
  2304 |     const composer = page.locator("textarea").first();
> 2305 |     await composer.fill(fixture.question);
       |                         ^ ReferenceError: fixture is not defined
  2306 |     await composer.locator("xpath=..").getByRole("button").click();
  2307 | 
  2308 |     await expect(
  2309 |       page.getByText(fixture.answer, { exact: true }).last(),
  2310 |     ).toBeVisible();
  2311 |     await expect(
  2312 |       page
  2313 |         .getByText("required tool did not complete — BLOCKED/INCOMPLETE", {
  2314 |           exact: false,
  2315 |         })
  2316 |         .last(),
  2317 |     ).toBeVisible();
  2318 |     await page
  2319 |       .locator("summary")
  2320 |       .filter({ hasText: "Agent activity" })
  2321 |       .last()
  2322 |       .click();
  2323 |     await expect(page.locator("body")).toContainText("Reading source");
  2324 |     await expect(page.locator("body")).toContainText(
  2325 |       "src/missing-release-fixture.ts",
  2326 |     );
  2327 |     await expect(page.locator("body")).toContainText("Tool failed");
  2328 |     await expect(page.locator("body")).toContainText("TOOL_EXECUTION_FAILED");
  2329 |     await page
  2330 |       .locator("summary")
  2331 |       .filter({ hasText: "Persisted execution proof" })
  2332 |       .last()
  2333 |       .click();
  2334 |     await expect(
  2335 |       page
  2336 |         .getByText("required tool failed — operation blocked", { exact: true })
  2337 |         .last(),
  2338 |     ).toBeVisible();
  2339 | 
  2340 |     const visibleText = await page.locator("body").innerText();
  2341 |     expect(visibleText).not.toMatch(
  2342 |       /rawPrompt|systemPrompt|provider diagnostics|source-window|recovery prompt|\/home\/runner/i,
  2343 |     );
  2344 |   });
  2345 | 
  2346 |   test("keeps safe citation state when switching projects", async ({
  2347 |     page,
  2348 |   }) => {
  2349 |     const accepted = await installArabicAiFixture(page, {
  2350 |       sessionId: "e2e-history-accepted-session",
  2351 |       question: "ما هو سلوك مهلة provider عند الرجوع عبر سجل المتصفح؟",
  2352 |     });
  2353 |     const blocked = await installArabicAiFixture(page, {
  2354 |       blocked: true,
  2355 |       sessionId: "e2e-history-blocked-session",
  2356 |       question: "ما هو الدليل المحجوب عند الرجوع عبر سجل المتصفح؟",
  2357 |     });
  2358 |     await installApiFixtures(page, {
  2359 |       arabicAi: accepted,
  2360 |       alternateAi: blocked,
  2361 |       projects: [
  2362 |         {
  2363 |           id: "e2e-project-one",
  2364 |           name: "Citation Project One",
  2365 |           language: "TypeScript",
  2366 |           framework: "React",
  2367 |           status: "active",
  2368 |           rootPath: "/controlled/project-one",
  2369 |           qualityScore: 92,
  2370 |         },
  2371 |         {
  2372 |           id: "e2e-project-two",
  2373 |           name: "Citation Project Two",
  2374 |           language: "TypeScript",
  2375 |           framework: "React",
  2376 |           status: "active",
  2377 |           rootPath: "/controlled/project-two",
  2378 |           qualityScore: 88,
  2379 |         },
  2380 |       ],
  2381 |     });
  2382 |     await programmaticSignIn(page);
  2383 |     await page.goto(`${DASHBOARD_PATH}ai`);
  2384 | 
  2385 |     await page
  2386 |       .getByRole("button", { name: accepted.question, exact: true })
  2387 |       .click();
  2388 |     await expect(
  2389 |       page.getByText(accepted.answer, { exact: true }).last(),
  2390 |     ).toBeVisible();
  2391 |     await expect(
  2392 |       page.getByText(`${accepted.source}:42`, { exact: false }).last(),
  2393 |     ).toBeVisible();
  2394 |     await expect(
  2395 |       page.getByText("Accepted: source span verified.", { exact: true }).last(),
  2396 |     ).toBeVisible();
  2397 | 
  2398 |     await page.getByRole("combobox").selectOption("e2e-project-two");
  2399 |     await expect(
  2400 |       page.getByRole("button", { name: blocked.question, exact: true }),
  2401 |     ).toBeVisible();
  2402 |     await expect(page.getByText(accepted.answer, { exact: true })).toHaveCount(
  2403 |       0,
  2404 |     );
  2405 |     await page
```