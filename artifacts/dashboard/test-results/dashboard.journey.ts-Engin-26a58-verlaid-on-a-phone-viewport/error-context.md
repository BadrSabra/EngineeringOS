# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: dashboard.journey.ts >> EngineeringOS dashboard browser journey >> keeps the failed AI session drawer overlaid on a phone viewport
- Location: e2e/dashboard.journey.ts:2169:3

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
  2091 |     await assertBlockedCitation();
  2092 | 
  2093 |     await openNavigation(page, "Event Stream", `${DASHBOARD_PATH}events`);
  2094 |     await page.goBack();
  2095 |     await expect(page).toHaveURL(
  2096 |       new RegExp(`${DASHBOARD_PATH.replaceAll("/", "\\/")}ai$`),
  2097 |     );
  2098 |     await page
  2099 |       .getByRole("button", { name: blocked.question, exact: true })
  2100 |       .click();
  2101 |     await assertBlockedCitation();
  2102 |     await assertNoInternalCitationDetails();
  2103 | 
  2104 |     await page.goForward();
  2105 |     await expect(page).toHaveURL(
  2106 |       new RegExp(`${DASHBOARD_PATH.replaceAll("/", "\\/")}events$`),
  2107 |     );
  2108 |     await page.goBack();
  2109 |     await expect(page).toHaveURL(
  2110 |       new RegExp(`${DASHBOARD_PATH.replaceAll("/", "\\/")}ai$`),
  2111 |     );
  2112 |     await page
  2113 |       .getByRole("button", { name: blocked.question, exact: true })
  2114 |       .click();
  2115 |     await assertBlockedCitation();
  2116 |     await assertNoInternalCitationDetails();
  2117 |   });
  2118 | 
  2119 |   test("keeps only the safe blocked citation reason after chat reload", async ({
  2120 |     page,
  2121 |   }) => {
  2122 |     const fixture = await installArabicAiFixture(page);
  2123 |     await installApiFixtures(page, { arabicAi: fixture });
  2124 |     await programmaticSignIn(page);
  2125 |     await page.goto(`${DASHBOARD_PATH}ai`);
  2126 | 
  2127 |     const composer = page.locator("textarea").first();
  2128 |     await composer.fill(fixture.question);
  2129 |     await composer.locator("xpath=..").getByRole("button").click();
  2130 | 
  2131 |     await expect(
  2132 |       page.getByText(fixture.answer, { exact: true }).last(),
  2133 |     ).toBeVisible();
  2134 |     await expect(
  2135 |       page
  2136 |         .getByText("required tool did not complete — BLOCKED/INCOMPLETE", {
  2137 |           exact: false,
  2138 |         })
  2139 |         .last(),
  2140 |     ).toBeVisible();
  2141 |     await page
  2142 |       .locator("summary")
  2143 |       .filter({ hasText: "Agent activity" })
  2144 |       .last()
  2145 |       .click();
  2146 |     await expect(page.locator("body")).toContainText("Reading source");
  2147 |     await expect(page.locator("body")).toContainText(
  2148 |       "src/missing-release-fixture.ts",
  2149 |     );
  2150 |     await expect(page.locator("body")).toContainText("Tool failed");
  2151 |     await expect(page.locator("body")).toContainText("TOOL_EXECUTION_FAILED");
  2152 |     await page
  2153 |       .locator("summary")
  2154 |       .filter({ hasText: "Persisted execution proof" })
  2155 |       .last()
  2156 |       .click();
  2157 |     await expect(
  2158 |       page
  2159 |         .getByText("required tool failed — operation blocked", { exact: true })
  2160 |         .last(),
  2161 |     ).toBeVisible();
  2162 | 
  2163 |     const visibleText = await page.locator("body").innerText();
  2164 |     expect(visibleText).not.toContain("COMPLETED");
  2165 |     expect(visibleText).not.toContain("Persisted execution proof");
  2166 |     expect(visibleText).toContain("The required analysis did not complete.");
  2167 |   });
  2168 | 
  2169 |   test("keeps the failed AI session drawer overlaid on a phone viewport", async ({
  2170 |     page,
  2171 |   }) => {
  2172 |     await page.setViewportSize({ width: 390, height: 844 });
  2173 |     const fixture = await installArabicAiFixture(page);
  2174 |     await installApiFixtures(page, { arabicAi: fixture });
  2175 |     await programmaticSignIn(page);
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
> 2191 |     ).toBeVisible();
       |       ^ Error: expect(locator).toBeVisible() failed
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
```