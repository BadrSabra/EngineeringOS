# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: dashboard.journey.ts >> EngineeringOS dashboard browser journey >> preserves one partial answer after a provider disconnect and marks it incomplete
- Location: e2e/dashboard.journey.ts:2263:3

# Error details

```
Error: expect(locator).toHaveCount(expected) failed

Locator:  getByText('عند انتهاء مهلة مزود الذكاء الاصطناعي، يعيد المسار تقريرًا جزئيًا من الأدلة التي جُمعت بدل إصدار Finding غير مثبت.', { exact: true })
Expected: 1
Received: 2
Timeout:  10000ms

Call log:
  - Expect "toHaveCount" with timeout 10000ms
  - waiting for getByText('عند انتهاء مهلة مزود الذكاء الاصطناعي، يعيد المسار تقريرًا جزئيًا من الأدلة التي جُمعت بدل إصدار Finding غير مثبت.', { exact: true })
    23 × locator resolved to 2 elements
       - unexpected value "2"

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
                - generic [ref=f2e178]:
                  - paragraph [ref=f2e179]: عند انتهاء مهلة مزود الذكاء الاصطناعي، يعيد المسار تقريرًا جزئيًا من الأدلة التي جُمعت بدل إصدار Finding غير مثبت.
                  - heading "6) Final Judgment" [level=2] [ref=f2e180]
                  - paragraph [ref=f2e181]: NOT PROVEN
                - generic [ref=f2e182]:
                  - generic [ref=f2e183]: Behavior evidence · 1 excerpt
                  - generic [ref=f2e192]:
                    - generic [ref=f2e193]: "Accepted: source span verified."
                    - generic [ref=f2e197]: return partialFromCollectedEvidence("provider timeout");
                    - generic [ref=f2e198]:
                      - button "src/execution-tools.ts:42" [ref=f2e199]
                      - button "View file" [ref=f2e207]
                - generic [ref=f2e211]:
                  - generic [ref=f2e212]:
                    - generic [ref=f2e218]: Behavior answer
                    - generic [ref=f2e219]: confidence 100%
                  - paragraph [ref=f2e220]: عند انتهاء مهلة مزود الذكاء الاصطناعي، يعيد المسار تقريرًا جزئيًا من الأدلة التي جُمعت بدل إصدار Finding غير مثبت.
                  - generic [ref=f2e221]: src/execution-tools.ts
                  - generic [ref=f2e223]: "Answered fields: timeout behavior"
                  - generic [ref=f2e224]:
                    - generic [ref=f2e225]: Behavior evidence · 1 excerpt
                    - generic [ref=f2e234]:
                      - generic [ref=f2e235]: "Accepted: source span verified."
                      - generic [ref=f2e239]: return partialFromCollectedEvidence("provider timeout");
                      - generic [ref=f2e240]:
                        - button "src/execution-tools.ts:42" [ref=f2e241]
                        - button "View file" [ref=f2e249]
                - group [ref=f2e253]:
                  - generic "Agent activity · 1 events" [ref=f2e254] [cursor=pointer]:
                    - generic [ref=f2e257]: Agent activity
                    - generic [ref=f2e258]: · 1 events
                - button "Forensic evidence NOT PROVEN" [ref=f2e262]:
                  - generic [ref=f2e265]: Forensic evidence
                  - generic [ref=f2e266]: NOT PROVEN
            - generic [ref=f2e270]:
              - textbox "Ask about your codebase, tasks, or metrics… (Enter to send)" [ref=f2e271]
              - button [disabled]
  - region "Notifications (F8)":
    - list
```

# Test source

```ts
  2176 |     await page.goto(`${DASHBOARD_PATH}ai`);
  2177 | 
  2178 |     const composer = page.locator("textarea").first();
  2179 |     await composer.fill(fixture.question);
  2180 |     await composer.locator("xpath=..").getByRole("button").click();
  2181 | 
  2182 |     await expect(
  2183 |       page.getByText(fixture.answer, { exact: true }).last(),
  2184 |     ).toBeVisible();
  2185 |     await expect(
  2186 |       page
  2187 |         .getByText("required tool did not complete — BLOCKED/INCOMPLETE", {
  2188 |           exact: false,
  2189 |         })
  2190 |         .last(),
  2191 |     ).toBeVisible();
  2192 |     await page
  2193 |       .locator("summary")
  2194 |       .filter({ hasText: "Agent activity" })
  2195 |       .last()
  2196 |       .click();
  2197 |     await expect(page.locator("body")).toContainText("Reading source");
  2198 |     await expect(page.locator("body")).toContainText(
  2199 |       "src/missing-release-fixture.ts",
  2200 |     );
  2201 |     await expect(page.locator("body")).toContainText("Tool failed");
  2202 |     await expect(page.locator("body")).toContainText("TOOL_EXECUTION_FAILED");
  2203 |     await page
  2204 |       .locator("summary")
  2205 |       .filter({ hasText: "Persisted execution proof" })
  2206 |       .last()
  2207 |       .click();
  2208 |     await expect(
  2209 |       page
  2210 |         .getByText("required tool failed — operation blocked", { exact: true })
  2211 |         .last(),
  2212 |     ).toBeVisible();
  2213 | 
  2214 |     const visibleText = await page.locator("body").innerText();
  2215 |     expect(visibleText).not.toMatch(
  2216 |       /raw exception|stack trace|\/home\/runner|secret|fixture diagnostic/i,
  2217 |     );
  2218 | 
  2219 |     await page.reload();
  2220 |     await page
  2221 |       .getByRole("button", { name: fixture.question, exact: true })
  2222 |       .click();
  2223 | 
  2224 |     await expect(
  2225 |       page.getByText(fixture.answer, { exact: true }).last(),
  2226 |     ).toBeVisible();
  2227 |     await expect(
  2228 |       page
  2229 |         .getByText("required tool did not complete — BLOCKED/INCOMPLETE", {
  2230 |           exact: false,
  2231 |         })
  2232 |         .last(),
  2233 |     ).toBeVisible();
  2234 |     await page
  2235 |       .locator("summary")
  2236 |       .filter({ hasText: "Agent activity" })
  2237 |       .last()
  2238 |       .click();
  2239 |     await expect(page.locator("body")).toContainText("Reading source");
  2240 |     await expect(page.locator("body")).toContainText(
  2241 |       "src/missing-release-fixture.ts",
  2242 |     );
  2243 |     await expect(page.locator("body")).toContainText("Tool failed");
  2244 |     await expect(page.locator("body")).toContainText("TOOL_EXECUTION_FAILED");
  2245 |     await page
  2246 |       .locator("summary")
  2247 |       .filter({ hasText: "Persisted execution proof" })
  2248 |       .last()
  2249 |       .click();
  2250 |     await expect(
  2251 |       page
  2252 |         .getByText("required tool failed — operation blocked", { exact: true })
  2253 |         .last(),
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
> 2276 |     await expect(answer).toHaveCount(1);
       |                          ^ Error: expect(locator).toHaveCount(expected) failed
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
  2354 |     const resumeRequest = page.waitForRequest(
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
```