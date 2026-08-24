# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: dashboard.journey.ts >> EngineeringOS dashboard browser journey >> renders an Arabic source-backed AI answer without internal diagnostics
- Location: e2e/dashboard.journey.ts:2156:3

# Error details

```
Error: expect(received).toContain(expected) // indexOf

Expected substring: "The required analysis did not complete."
Received string:    "EngineeringOS
CORE OPS
Dashboard
Projects
Tasks
Rules Engine
Workflows
Event Stream
Metrics
Knowledge Graph
AI Assistant
Flight Deck
Mission Control
ED
EngineeringOS Dashboard Smoke
Connected
v1.0.4-stable
SESSIONS
Smoke Project
ماذا يحدث عند انتهاء مهلة provider timeout داخل execution-tools.ts؟
OPENROUTER API KEY
Priority·
Loading…·
Save
GEMINI API KEY
Free · Priority·
Loading…·
Save
DEEPSEEK API KEY
Optional·
Loading…·
Save
GROQ API KEY·
Loading…·
Save
EngineeringOS AI
Llama 3.3 · Groq
ماذا يحدث عند انتهاء مهلة provider timeout داخل execution-tools.ts؟·
عند انتهاء مهلة مزود الذكاء الاصطناعي، يعيد المسار تقريرًا جزئيًا من الأدلة التي جُمعت بدل إصدار Finding غير مثبت.·
6) Final Judgment·
NOT PROVEN·
Behavior evidence · 1 excerpt
Accepted: source span verified.
return partialFromCollectedEvidence(\"provider timeout\");
src/execution-tools.ts:42
View file
Behavior answer
confidence 100%·
عند انتهاء مهلة مزود الذكاء الاصطناعي، يعيد المسار تقريرًا جزئيًا من الأدلة التي جُمعت بدل إصدار Finding غير مثبت.·
src/execution-tools.ts
Answered fields: timeout behavior
Behavior evidence · 1 excerpt
Accepted: source span verified.
return partialFromCollectedEvidence(\"provider timeout\");
src/execution-tools.ts:42
View file
Agent activity
· 1 events
✓
Reading source · src/execution-tools.ts
src/execution-tools.ts
Forensic evidence
NOT PROVEN"
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
                  - generic "Agent activity · 1 events" [active] [ref=f2e254] [cursor=pointer]:
                    - generic [ref=f2e257]: Agent activity
                    - generic [ref=f2e258]: · 1 events
                  - generic [ref=f2e262]:
                    - generic [ref=f2e263]: ✓
                    - generic [ref=f2e264]: Reading source · src/execution-tools.ts
                    - code [ref=f2e265]: src/execution-tools.ts
                - button "Forensic evidence NOT PROVEN" [ref=f2e267]:
                  - generic [ref=f2e270]: Forensic evidence
                  - generic [ref=f2e271]: NOT PROVEN
            - generic [ref=f2e275]:
              - textbox "Ask about your codebase, tasks, or metrics… (Enter to send)" [ref=f2e276]
              - button [disabled]
  - region "Notifications (F8)":
    - list
```

# Test source

```ts
  2106 |           url.searchParams.get("page") === "2"
  2107 |         );
  2108 |       }),
  2109 |       page.getByRole("button", { name: "Older" }).click(),
  2110 |     ]);
  2111 |     await expect(page.getByText("Page 2.", { exact: false })).toBeVisible();
  2112 |     await expect(
  2113 |       page.getByText("Older event 50", { exact: true }),
  2114 |     ).toBeVisible();
  2115 |     await expect(
  2116 |       page.getByText("Filtered release event 0", { exact: true }),
  2117 |     ).not.toBeVisible();
  2118 |     expect(new URL(eventRequests.at(-1)!).searchParams.get("page")).toBe("2");
  2119 |     await page.getByRole("button", { name: "Newer" }).click();
  2120 |     await expect(page.getByText("Page 1.", { exact: false })).toBeVisible();
  2121 |     await expect(
  2122 |       page.getByText("Filtered release event 0", { exact: true }),
  2123 |     ).toBeVisible();
  2124 | 
  2125 |     await page.getByPlaceholder("Search logs...").fill("Filtered release");
  2126 |     await page.getByRole("button", { name: "Toggle event filters" }).click();
  2127 |     await page.locator("select").nth(1).selectOption("success");
  2128 |     await expect(
  2129 |       page.getByText("Filtered release event 0", { exact: true }),
  2130 |     ).toBeVisible();
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
> 2206 |     expect(visibleText).toContain("The required analysis did not complete.");
       |                         ^ Error: expect(received).toContain(expected) // indexOf
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
```