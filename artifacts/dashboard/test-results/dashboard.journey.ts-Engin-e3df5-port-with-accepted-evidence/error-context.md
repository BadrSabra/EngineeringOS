# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: dashboard.journey.ts >> EngineeringOS dashboard browser journey >> keeps the AI session drawer overlaid on a phone viewport with accepted evidence
- Location: e2e/dashboard.journey.ts:2233:3

# Error details

```
Error: expect(locator).toBeVisible() failed

Locator: getByText('required tool did not complete — BLOCKED/INCOMPLETE').last()
Expected: visible
Timeout: 10000ms
Error: element(s) not found

Call log:
  - Expect "toBeVisible" with timeout 10000ms
  - waiting for getByText('required tool did not complete — BLOCKED/INCOMPLETE').last()

```

```yaml
- banner:
  - button "Open navigation"
  - textbox "Search projects, tasks, rules... (Press '/')"
  - button
- main:
  - button "Open sessions"
  - text: EngineeringOS AI Llama 3.3 · Groq ماذا يحدث عند انتهاء مهلة provider timeout داخل execution-tools.ts؟
  - paragraph: عند انتهاء مهلة مزود الذكاء الاصطناعي، يعيد المسار تقريرًا جزئيًا من الأدلة التي جُمعت بدل إصدار Finding غير مثبت.
  - heading "6) Final Judgment" [level=2]
  - paragraph: NOT PROVEN
  - text: "Behavior evidence · 1 excerpt Accepted: source span verified. return partialFromCollectedEvidence(\"provider timeout\");"
  - button "src/execution-tools.ts:42"
  - button "View file"
  - text: Behavior answer confidence 100%
  - paragraph: عند انتهاء مهلة مزود الذكاء الاصطناعي، يعيد المسار تقريرًا جزئيًا من الأدلة التي جُمعت بدل إصدار Finding غير مثبت.
  - text: "src/execution-tools.ts Answered fields: timeout behavior Behavior evidence · 1 excerpt Accepted: source span verified. return partialFromCollectedEvidence(\"provider timeout\");"
  - button "src/execution-tools.ts:42"
  - button "View file"
  - group: Agent activity · 1 events
  - button "Forensic evidence NOT PROVEN"
  - textbox "Ask about your codebase, tasks, or metrics… (Enter to send)"
  - button [disabled]
- region "Notifications (F8)":
  - list
```

# Test source

```ts
  2155 |     await expect(
  2156 |       page.getByText("Older event 1", { exact: true }),
  2157 |     ).not.toBeVisible();
  2158 |     await expect(page).toHaveURL(/search=Filtered\+release/);
  2159 |     await expect(page).toHaveURL(/severity=success/);
  2160 | 
  2161 |     await page.reload();
  2162 |     await expect(
  2163 |       page.getByText("Filtered release event 0", { exact: true }),
  2164 |     ).toBeVisible();
  2165 |     await expect(
  2166 |       page.getByText("Older event 1", { exact: true }),
  2167 |     ).not.toBeVisible();
  2168 |     await expect(page.getByPlaceholder("Search logs...")).toHaveValue(
  2169 |       "Filtered release",
  2170 |     );
  2171 |     await page.getByRole("button", { name: "Toggle event filters" }).click();
  2172 |     await expect(page.locator("select").nth(1)).toHaveValue("success");
  2173 |     const filteredRequest = new URL(eventRequests.at(-1)!);
  2174 |     expect(filteredRequest.searchParams.get("limit")).toBe("50");
  2175 |     expect(filteredRequest.searchParams.get("page")).toBe("1");
  2176 |     expect(filteredRequest.searchParams.get("search")).toBe("Filtered release");
  2177 |     expect(filteredRequest.searchParams.get("severity")).toBe("success");
  2178 |   });
  2179 | 
  2180 |   test("renders an Arabic source-backed AI answer without internal diagnostics", async ({
  2181 |     page,
  2182 |   }) => {
  2183 |     const fixture = await installArabicAiFixture(page);
  2184 |     await installApiFixtures(page, { arabicAi: fixture });
  2185 |     await programmaticSignIn(page);
  2186 |     await page.goto(`${DASHBOARD_PATH}ai`);
  2187 | 
  2188 |     const composer = page.locator("textarea").first();
  2189 |     await expect(composer).toBeVisible();
  2190 |     await composer.fill(fixture.question);
  2191 |     const sendButton = composer.locator("xpath=..").getByRole("button");
  2192 |     await expect(sendButton).toBeEnabled();
  2193 |     const streamResponsePromise = page.waitForResponse((response) =>
  2194 |       response.url().includes("/api/ai/chat/stream"),
  2195 |     );
  2196 |     await sendButton.click();
  2197 |     const streamResponse = await streamResponsePromise;
  2198 |     expect(streamResponse.status()).toBe(200);
  2199 | 
  2200 |     await expect(
  2201 |       page.getByText(fixture.question, { exact: true }).last(),
  2202 |     ).toBeVisible();
  2203 |     await expect(
  2204 |       page.getByText(fixture.answer, { exact: true }).last(),
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
> 2255 |     ).toBeVisible();
       |       ^ Error: expect(locator).toBeVisible() failed
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
  2305 |     await composer.fill(fixture.question);
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
```