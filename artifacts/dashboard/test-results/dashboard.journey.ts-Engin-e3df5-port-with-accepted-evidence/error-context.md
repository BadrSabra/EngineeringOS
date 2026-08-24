# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: dashboard.journey.ts >> EngineeringOS dashboard browser journey >> keeps the AI session drawer overlaid on a phone viewport with accepted evidence
- Location: e2e/dashboard.journey.ts:2118:3

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
  2040 |     await expect(
  2041 |       page.getByText("Older event 1", { exact: true }),
  2042 |     ).not.toBeVisible();
  2043 |     await expect(page).toHaveURL(/search=Filtered\+release/);
  2044 |     await expect(page).toHaveURL(/severity=success/);
  2045 | 
  2046 |     await page.reload();
  2047 |     await expect(
  2048 |       page.getByText("Filtered release event 0", { exact: true }),
  2049 |     ).toBeVisible();
  2050 |     await expect(
  2051 |       page.getByText("Older event 1", { exact: true }),
  2052 |     ).not.toBeVisible();
  2053 |     await expect(page.getByPlaceholder("Search logs...")).toHaveValue(
  2054 |       "Filtered release",
  2055 |     );
  2056 |     await page.getByRole("button", { name: "Toggle event filters" }).click();
  2057 |     await expect(page.locator("select").nth(1)).toHaveValue("success");
  2058 |     const filteredRequest = new URL(eventRequests.at(-1)!);
  2059 |     expect(filteredRequest.searchParams.get("limit")).toBe("50");
  2060 |     expect(filteredRequest.searchParams.get("page")).toBe("1");
  2061 |     expect(filteredRequest.searchParams.get("search")).toBe("Filtered release");
  2062 |     expect(filteredRequest.searchParams.get("severity")).toBe("success");
  2063 |   });
  2064 | 
  2065 |   test("renders an Arabic source-backed AI answer without internal diagnostics", async ({
  2066 |     page,
  2067 |   }) => {
  2068 |     const fixture = await installArabicAiFixture(page);
  2069 |     await installApiFixtures(page, { arabicAi: fixture });
  2070 |     await programmaticSignIn(page);
  2071 |     await page.goto(`${DASHBOARD_PATH}ai`);
  2072 | 
  2073 |     const composer = page.locator("textarea").first();
  2074 |     await expect(composer).toBeVisible();
  2075 |     await composer.fill(fixture.question);
  2076 |     const sendButton = composer.locator("xpath=..").getByRole("button");
  2077 |     await expect(sendButton).toBeEnabled();
  2078 |     const streamResponsePromise = page.waitForResponse((response) =>
  2079 |       response.url().includes("/api/ai/chat/stream"),
  2080 |     );
  2081 |     await sendButton.click();
  2082 |     const streamResponse = await streamResponsePromise;
  2083 |     expect(streamResponse.status()).toBe(200);
  2084 | 
  2085 |     await expect(
  2086 |       page.getByText(fixture.question, { exact: true }).last(),
  2087 |     ).toBeVisible();
  2088 |     await expect(
  2089 |       page.getByText(fixture.answer, { exact: true }).last(),
  2090 |     ).toBeVisible();
  2091 |     await expect(
  2092 |       page.getByText("Agent activity", { exact: false }),
  2093 |     ).toBeVisible();
  2094 |     await page.locator("summary").filter({ hasText: "Agent activity" }).click();
  2095 |     await expect(
  2096 |       page.getByText("Reading source", { exact: false }),
  2097 |     ).toBeVisible();
  2098 |     await expect(
  2099 |       page.getByText(fixture.source, { exact: true }).last(),
  2100 |     ).toBeVisible();
  2101 |     await expect(
  2102 |       page.getByText(/Behavior evidence · 1 excerpt/i).last(),
  2103 |     ).toBeVisible();
  2104 |     await expect(
  2105 |       page
  2106 |         .getByText('return partialFromCollectedEvidence("provider timeout");', {
  2107 |           exact: true,
  2108 |         })
  2109 |         .last(),
  2110 |     ).toBeVisible();
  2111 | 
  2112 |     const visibleText = await page.locator("body").innerText();
  2113 |     expect(visibleText).not.toContain("COMPLETED");
  2114 |     expect(visibleText).not.toContain("Persisted execution proof");
  2115 |     expect(visibleText).toContain("The required analysis did not complete.");
  2116 |   });
  2117 | 
  2118 |   test("keeps the AI session drawer overlaid on a phone viewport with accepted evidence", async ({
  2119 |     page,
  2120 |   }) => {
  2121 |     await page.setViewportSize({ width: 390, height: 844 });
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
> 2140 |     ).toBeVisible();
       |       ^ Error: expect(locator).toBeVisible() failed
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
  2162 |     await expectNoHorizontalOverflow(page);
  2163 | 
  2164 |     const visibleText = await page.locator("body").innerText();
  2165 |     expect(visibleText).not.toMatch(
  2166 |       /rawPrompt|systemPrompt|provider diagnostics|source-window|recovery prompt|\/home\/runner/i,
  2167 |     );
  2168 |   });
  2169 | 
  2170 |   test("keeps safe citation state across browser back and forward navigation with blocked evidence", async ({
  2171 |     page,
  2172 |   }) => {
  2173 |     const accepted = await installArabicAiFixture(page, {
  2174 |       sessionId: "e2e-history-accepted-session",
  2175 |       question: "ما هو سلوك مهلة provider عند الرجوع عبر سجل المتصفح؟",
  2176 |     });
  2177 |     const blocked = await installArabicAiFixture(page, {
  2178 |       blocked: true,
  2179 |       sessionId: "e2e-history-blocked-session",
  2180 |       question: "ما هو الدليل المحجوب عند الرجوع عبر سجل المتصفح؟",
  2181 |     });
  2182 |     await installApiFixtures(page, {
  2183 |       arabicAi: accepted,
  2184 |       alternateAi: blocked,
  2185 |     });
  2186 |     await programmaticSignIn(page);
  2187 |     await page.goto(`${DASHBOARD_PATH}ai`);
  2188 | 
  2189 |     const composer = page.locator("textarea").first();
  2190 |     await composer.fill(fixture.question);
  2191 |     await composer.locator("xpath=..").getByRole("button").click();
  2192 | 
  2193 |     await expect(
  2194 |       page.getByText(fixture.answer, { exact: true }).last(),
  2195 |     ).toBeVisible();
  2196 |     await expect(
  2197 |       page
  2198 |         .getByText("required tool did not complete — BLOCKED/INCOMPLETE", {
  2199 |           exact: false,
  2200 |         })
  2201 |         .last(),
  2202 |     ).toBeVisible();
  2203 |     await page
  2204 |       .locator("summary")
  2205 |       .filter({ hasText: "Agent activity" })
  2206 |       .last()
  2207 |       .click();
  2208 |     await expect(page.locator("body")).toContainText("Reading source");
  2209 |     await expect(page.locator("body")).toContainText(
  2210 |       "src/missing-release-fixture.ts",
  2211 |     );
  2212 |     await expect(page.locator("body")).toContainText("Tool failed");
  2213 |     await expect(page.locator("body")).toContainText("TOOL_EXECUTION_FAILED");
  2214 |     await page
  2215 |       .locator("summary")
  2216 |       .filter({ hasText: "Persisted execution proof" })
  2217 |       .last()
  2218 |       .click();
  2219 |     await expect(
  2220 |       page
  2221 |         .getByText("required tool failed — operation blocked", { exact: true })
  2222 |         .last(),
  2223 |     ).toBeVisible();
  2224 | 
  2225 |     const visibleText = await page.locator("body").innerText();
  2226 |     expect(visibleText).not.toMatch(
  2227 |       /rawPrompt|systemPrompt|provider diagnostics|source-window|recovery prompt|\/home\/runner/i,
  2228 |     );
  2229 |   });
  2230 | 
  2231 |   test("keeps safe citation state when switching projects", async ({
  2232 |     page,
  2233 |   }) => {
  2234 |     const accepted = await installArabicAiFixture(page, {
  2235 |       sessionId: "e2e-history-accepted-session",
  2236 |       question: "ما هو سلوك مهلة provider عند الرجوع عبر سجل المتصفح؟",
  2237 |     });
  2238 |     const blocked = await installArabicAiFixture(page, {
  2239 |       blocked: true,
  2240 |       sessionId: "e2e-history-blocked-session",
```