# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: dashboard.journey.ts >> EngineeringOS dashboard browser journey >> keeps only the safe blocked citation reason after chat reload
- Location: e2e/dashboard.journey.ts:2119:3

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
- text: ED EngineeringOS Dashboard Smoke Connected
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
  - button "ماذا يحدث عند انتهاء مهلة provider timeout داخل execution-tools.ts؟"
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
  2040 |           .getByText("Blocked: no matching source text was found.", {
  2041 |             exact: true,
  2042 |           })
  2043 |           .last(),
  2044 |       ).toBeVisible();
  2045 |       await expect(
  2046 |         page.getByText(`${blocked.source}:42`, { exact: false }),
  2047 |       ).toHaveCount(0);
  2048 |       await expect(
  2049 |         page.getByText("Accepted: source span verified.", { exact: true }),
  2050 |       ).toHaveCount(0);
  2051 |     };
  2052 |     const assertNoInternalCitationDetails = async () => {
  2053 |       const visibleText = await page.locator("body").innerText();
  2054 |       expect(visibleText).not.toMatch(
  2055 |         /MISSING_LITERAL_MATCH|rawPrompt|systemPrompt|provider diagnostics|source-window|recovery prompt|\/home\/runner/i,
  2056 |       );
  2057 |     };
  2058 | 
  2059 |     await page
  2060 |       .getByRole("button", { name: accepted.question, exact: true })
  2061 |       .click();
  2062 |     await assertAcceptedCitation();
  2063 | 
  2064 |     await openNavigation(page, "Projects", `${DASHBOARD_PATH}projects`);
  2065 |     await page.goBack();
  2066 |     await expect(page).toHaveURL(
  2067 |       new RegExp(`${DASHBOARD_PATH.replaceAll("/", "\\/")}ai$`),
  2068 |     );
  2069 |     await page
  2070 |       .getByRole("button", { name: accepted.question, exact: true })
  2071 |       .click();
  2072 |     await assertAcceptedCitation();
  2073 |     await assertNoInternalCitationDetails();
  2074 | 
  2075 |     await page.goForward();
  2076 |     await expect(page).toHaveURL(
  2077 |       new RegExp(`${DASHBOARD_PATH.replaceAll("/", "\\/")}projects$`),
  2078 |     );
  2079 |     await page.goBack();
  2080 |     await expect(page).toHaveURL(
  2081 |       new RegExp(`${DASHBOARD_PATH.replaceAll("/", "\\/")}ai$`),
  2082 |     );
  2083 |     await page
  2084 |       .getByRole("button", { name: accepted.question, exact: true })
  2085 |       .click();
  2086 |     await assertAcceptedCitation();
  2087 | 
  2088 |     await page
  2089 |       .getByRole("button", { name: blocked.question, exact: true })
  2090 |       .click();
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
```