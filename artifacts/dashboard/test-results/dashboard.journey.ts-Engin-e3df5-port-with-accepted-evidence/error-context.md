# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: dashboard.journey.ts >> EngineeringOS dashboard browser journey >> keeps the AI session drawer overlaid on a phone viewport with accepted evidence
- Location: e2e/dashboard.journey.ts:2209:3

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
  2131 |     await expect(
  2132 |       page.getByText("Older event 1", { exact: true }),
  2133 |     ).not.toBeVisible();
  2134 |     await expect(page).toHaveURL(/search=Filtered\+release/);
  2135 |     await expect(page).toHaveURL(/severity=success/);
  2136 | 
  2137 |     await page.reload();
  2138 |     await expect(
  2139 |       page.getByText("Filtered release event 0", { exact: true }),
  2140 |     ).toBeVisible();
  2141 |     await expect(
  2142 |       page.getByText("Older event 1", { exact: true }),
  2143 |     ).not.toBeVisible();
  2144 |     await expect(page.getByPlaceholder("Search logs...")).toHaveValue(
  2145 |       "Filtered release",
  2146 |     );
  2147 |     await page.getByRole("button", { name: "Toggle event filters" }).click();
  2148 |     await expect(page.locator("select").nth(1)).toHaveValue("success");
  2149 |     const filteredRequest = new URL(eventRequests.at(-1)!);
  2150 |     expect(filteredRequest.searchParams.get("limit")).toBe("50");
  2151 |     expect(filteredRequest.searchParams.get("page")).toBe("1");
  2152 |     expect(filteredRequest.searchParams.get("search")).toBe("Filtered release");
  2153 |     expect(filteredRequest.searchParams.get("severity")).toBe("success");
  2154 |   });
  2155 | 
  2156 |   test("renders an Arabic source-backed AI answer without internal diagnostics", async ({
  2157 |     page,
  2158 |   }) => {
  2159 |     const fixture = await installArabicAiFixture(page);
  2160 |     await installApiFixtures(page, { arabicAi: fixture });
  2161 |     await programmaticSignIn(page);
  2162 |     await page.goto(`${DASHBOARD_PATH}ai`);
  2163 | 
  2164 |     const composer = page.locator("textarea").first();
  2165 |     await expect(composer).toBeVisible();
  2166 |     await composer.fill(fixture.question);
  2167 |     const sendButton = composer.locator("xpath=..").getByRole("button");
  2168 |     await expect(sendButton).toBeEnabled();
  2169 |     const streamResponsePromise = page.waitForResponse((response) =>
  2170 |       response.url().includes("/api/ai/chat/stream"),
  2171 |     );
  2172 |     await sendButton.click();
  2173 |     const streamResponse = await streamResponsePromise;
  2174 |     expect(streamResponse.status()).toBe(200);
  2175 | 
  2176 |     await expect(
  2177 |       page.getByText(fixture.question, { exact: true }).last(),
  2178 |     ).toBeVisible();
  2179 |     await expect(
  2180 |       page.getByText(fixture.answer, { exact: true }).last(),
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
> 2231 |     ).toBeVisible();
       |       ^ Error: expect(locator).toBeVisible() failed
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
  2281 |     await composer.fill(fixture.question);
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
```