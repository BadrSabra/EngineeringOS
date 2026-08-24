# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: dashboard.journey.ts >> EngineeringOS dashboard browser journey >> keeps safe citation state across browser back and forward navigation with blocked evidence
- Location: e2e/dashboard.journey.ts:2170:3

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
> 2190 |     await composer.fill(fixture.question);
       |                         ^ ReferenceError: fixture is not defined
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
  2241 |       question: "ما هو الدليل المحجوب عند الرجوع عبر سجل المتصفح؟",
  2242 |     });
  2243 |     await installApiFixtures(page, {
  2244 |       arabicAi: accepted,
  2245 |       alternateAi: blocked,
  2246 |       projects: [
  2247 |         {
  2248 |           id: "e2e-project-one",
  2249 |           name: "Citation Project One",
  2250 |           language: "TypeScript",
  2251 |           framework: "React",
  2252 |           status: "active",
  2253 |           rootPath: "/controlled/project-one",
  2254 |           qualityScore: 92,
  2255 |         },
  2256 |         {
  2257 |           id: "e2e-project-two",
  2258 |           name: "Citation Project Two",
  2259 |           language: "TypeScript",
  2260 |           framework: "React",
  2261 |           status: "active",
  2262 |           rootPath: "/controlled/project-two",
  2263 |           qualityScore: 88,
  2264 |         },
  2265 |       ],
  2266 |     });
  2267 |     await programmaticSignIn(page);
  2268 |     await page.goto(`${DASHBOARD_PATH}ai`);
  2269 | 
  2270 |     await page
  2271 |       .getByRole("button", { name: accepted.question, exact: true })
  2272 |       .click();
  2273 |     await expect(
  2274 |       page.getByText(accepted.answer, { exact: true }).last(),
  2275 |     ).toBeVisible();
  2276 |     await expect(
  2277 |       page.getByText(`${accepted.source}:42`, { exact: false }).last(),
  2278 |     ).toBeVisible();
  2279 |     await expect(
  2280 |       page.getByText("Accepted: source span verified.", { exact: true }).last(),
  2281 |     ).toBeVisible();
  2282 | 
  2283 |     await page.getByRole("combobox").selectOption("e2e-project-two");
  2284 |     await expect(
  2285 |       page.getByRole("button", { name: blocked.question, exact: true }),
  2286 |     ).toBeVisible();
  2287 |     await expect(page.getByText(accepted.answer, { exact: true })).toHaveCount(
  2288 |       0,
  2289 |     );
  2290 |     await page
```