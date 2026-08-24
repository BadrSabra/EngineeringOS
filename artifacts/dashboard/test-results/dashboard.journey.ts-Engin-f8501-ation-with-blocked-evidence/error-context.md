# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: dashboard.journey.ts >> EngineeringOS dashboard browser journey >> keeps safe citation state across browser back and forward navigation with blocked evidence
- Location: e2e/dashboard.journey.ts:2261:3

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
  2181 |     ).toBeVisible();
  2182 |     await expect(
  2183 |       page.getByText("Agent activity", { exact: false }),
  2184 |     ).toBeVisible();
  2185 |     await page.locator("summary").filter({ hasText: "Agent activity" }).click();
  2186 |     await expect(
  2187 |       page.getByText("Reading source", { exact: false }),
  2188 |     ).toBeVisible();
  2189 |     await expect(
  2190 |       page.getByText(fixture.source, { exact: true }).last(),
  2191 |     ).toBeVisible();
  2192 |     await expect(
  2193 |       page.getByText(/Behavior evidence · 1 excerpt/i).last(),
  2194 |     ).toBeVisible();
  2195 |     await expect(
  2196 |       page
  2197 |         .getByText('return partialFromCollectedEvidence("provider timeout");', {
  2198 |           exact: true,
  2199 |         })
  2200 |         .last(),
  2201 |     ).toBeVisible();
  2202 | 
  2203 |     const visibleText = await page.locator("body").innerText();
  2204 |     expect(visibleText).not.toContain("COMPLETED");
  2205 |     expect(visibleText).not.toContain("Persisted execution proof");
  2206 |     expect(visibleText).toContain("The required analysis did not complete.");
  2207 |   });
  2208 | 
  2209 |   test("keeps the AI session drawer overlaid on a phone viewport with accepted evidence", async ({
  2210 |     page,
  2211 |   }) => {
  2212 |     await page.setViewportSize({ width: 390, height: 844 });
  2213 |     const fixture = await installArabicAiFixture(page);
  2214 |     await installApiFixtures(page, { arabicAi: fixture });
  2215 |     await programmaticSignIn(page);
  2216 |     await page.goto(`${DASHBOARD_PATH}ai`);
  2217 | 
  2218 |     const composer = page.locator("textarea").first();
  2219 |     await composer.fill(fixture.question);
  2220 |     await composer.locator("xpath=..").getByRole("button").click();
  2221 | 
  2222 |     await expect(
  2223 |       page.getByText(fixture.answer, { exact: true }).last(),
  2224 |     ).toBeVisible();
  2225 |     await expect(
  2226 |       page
  2227 |         .getByText("required tool did not complete — BLOCKED/INCOMPLETE", {
  2228 |           exact: false,
  2229 |         })
  2230 |         .last(),
  2231 |     ).toBeVisible();
  2232 |     await page
  2233 |       .locator("summary")
  2234 |       .filter({ hasText: "Agent activity" })
  2235 |       .last()
  2236 |       .click();
  2237 |     await expect(page.locator("body")).toContainText("Reading source");
  2238 |     await expect(page.locator("body")).toContainText(
  2239 |       "src/missing-release-fixture.ts",
  2240 |     );
  2241 |     await expect(page.locator("body")).toContainText("Tool failed");
  2242 |     await expect(page.locator("body")).toContainText("TOOL_EXECUTION_FAILED");
  2243 |     await page
  2244 |       .locator("summary")
  2245 |       .filter({ hasText: "Persisted execution proof" })
  2246 |       .last()
  2247 |       .click();
  2248 |     await expect(
  2249 |       page
  2250 |         .getByText("required tool failed — operation blocked", { exact: true })
  2251 |         .last(),
  2252 |     ).toBeVisible();
  2253 |     await expectNoHorizontalOverflow(page);
  2254 | 
  2255 |     const visibleText = await page.locator("body").innerText();
  2256 |     expect(visibleText).not.toMatch(
  2257 |       /rawPrompt|systemPrompt|provider diagnostics|source-window|recovery prompt|\/home\/runner/i,
  2258 |     );
  2259 |   });
  2260 | 
  2261 |   test("keeps safe citation state across browser back and forward navigation with blocked evidence", async ({
  2262 |     page,
  2263 |   }) => {
  2264 |     const accepted = await installArabicAiFixture(page, {
  2265 |       sessionId: "e2e-history-accepted-session",
  2266 |       question: "ما هو سلوك مهلة provider عند الرجوع عبر سجل المتصفح؟",
  2267 |     });
  2268 |     const blocked = await installArabicAiFixture(page, {
  2269 |       blocked: true,
  2270 |       sessionId: "e2e-history-blocked-session",
  2271 |       question: "ما هو الدليل المحجوب عند الرجوع عبر سجل المتصفح؟",
  2272 |     });
  2273 |     await installApiFixtures(page, {
  2274 |       arabicAi: accepted,
  2275 |       alternateAi: blocked,
  2276 |     });
  2277 |     await programmaticSignIn(page);
  2278 |     await page.goto(`${DASHBOARD_PATH}ai`);
  2279 | 
  2280 |     const composer = page.locator("textarea").first();
> 2281 |     await composer.fill(fixture.question);
       |                         ^ ReferenceError: fixture is not defined
  2282 |     await composer.locator("xpath=..").getByRole("button").click();
  2283 | 
  2284 |     await expect(
  2285 |       page.getByText(fixture.answer, { exact: true }).last(),
  2286 |     ).toBeVisible();
  2287 |     await expect(
  2288 |       page
  2289 |         .getByText("required tool did not complete — BLOCKED/INCOMPLETE", {
  2290 |           exact: false,
  2291 |         })
  2292 |         .last(),
  2293 |     ).toBeVisible();
  2294 |     await page
  2295 |       .locator("summary")
  2296 |       .filter({ hasText: "Agent activity" })
  2297 |       .last()
  2298 |       .click();
  2299 |     await expect(page.locator("body")).toContainText("Reading source");
  2300 |     await expect(page.locator("body")).toContainText(
  2301 |       "src/missing-release-fixture.ts",
  2302 |     );
  2303 |     await expect(page.locator("body")).toContainText("Tool failed");
  2304 |     await expect(page.locator("body")).toContainText("TOOL_EXECUTION_FAILED");
  2305 |     await page
  2306 |       .locator("summary")
  2307 |       .filter({ hasText: "Persisted execution proof" })
  2308 |       .last()
  2309 |       .click();
  2310 |     await expect(
  2311 |       page
  2312 |         .getByText("required tool failed — operation blocked", { exact: true })
  2313 |         .last(),
  2314 |     ).toBeVisible();
  2315 | 
  2316 |     const visibleText = await page.locator("body").innerText();
  2317 |     expect(visibleText).not.toMatch(
  2318 |       /rawPrompt|systemPrompt|provider diagnostics|source-window|recovery prompt|\/home\/runner/i,
  2319 |     );
  2320 |   });
  2321 | 
  2322 |   test("keeps safe citation state when switching projects", async ({
  2323 |     page,
  2324 |   }) => {
  2325 |     const accepted = await installArabicAiFixture(page, {
  2326 |       sessionId: "e2e-history-accepted-session",
  2327 |       question: "ما هو سلوك مهلة provider عند الرجوع عبر سجل المتصفح؟",
  2328 |     });
  2329 |     const blocked = await installArabicAiFixture(page, {
  2330 |       blocked: true,
  2331 |       sessionId: "e2e-history-blocked-session",
  2332 |       question: "ما هو الدليل المحجوب عند الرجوع عبر سجل المتصفح؟",
  2333 |     });
  2334 |     await installApiFixtures(page, {
  2335 |       arabicAi: accepted,
  2336 |       alternateAi: blocked,
  2337 |       projects: [
  2338 |         {
  2339 |           id: "e2e-project-one",
  2340 |           name: "Citation Project One",
  2341 |           language: "TypeScript",
  2342 |           framework: "React",
  2343 |           status: "active",
  2344 |           rootPath: "/controlled/project-one",
  2345 |           qualityScore: 92,
  2346 |         },
  2347 |         {
  2348 |           id: "e2e-project-two",
  2349 |           name: "Citation Project Two",
  2350 |           language: "TypeScript",
  2351 |           framework: "React",
  2352 |           status: "active",
  2353 |           rootPath: "/controlled/project-two",
  2354 |           qualityScore: 88,
  2355 |         },
  2356 |       ],
  2357 |     });
  2358 |     await programmaticSignIn(page);
  2359 |     await page.goto(`${DASHBOARD_PATH}ai`);
  2360 | 
  2361 |     await page
  2362 |       .getByRole("button", { name: accepted.question, exact: true })
  2363 |       .click();
  2364 |     await expect(
  2365 |       page.getByText(accepted.answer, { exact: true }).last(),
  2366 |     ).toBeVisible();
  2367 |     await expect(
  2368 |       page.getByText(`${accepted.source}:42`, { exact: false }).last(),
  2369 |     ).toBeVisible();
  2370 |     await expect(
  2371 |       page.getByText("Accepted: source span verified.", { exact: true }).last(),
  2372 |     ).toBeVisible();
  2373 | 
  2374 |     await page.getByRole("combobox").selectOption("e2e-project-two");
  2375 |     await expect(
  2376 |       page.getByRole("button", { name: blocked.question, exact: true }),
  2377 |     ).toBeVisible();
  2378 |     await expect(page.getByText(accepted.answer, { exact: true })).toHaveCount(
  2379 |       0,
  2380 |     );
  2381 |     await page
```