# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: dashboard.journey.ts >> EngineeringOS dashboard browser journey >> renders an Arabic source-backed AI answer without internal diagnostics
- Location: e2e/dashboard.journey.ts:2180:3

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
  2130 |           url.searchParams.get("page") === "2"
  2131 |         );
  2132 |       }),
  2133 |       page.getByRole("button", { name: "Older" }).click(),
  2134 |     ]);
  2135 |     await expect(page.getByText("Page 2.", { exact: false })).toBeVisible();
  2136 |     await expect(
  2137 |       page.getByText("Older event 50", { exact: true }),
  2138 |     ).toBeVisible();
  2139 |     await expect(
  2140 |       page.getByText("Filtered release event 0", { exact: true }),
  2141 |     ).not.toBeVisible();
  2142 |     expect(new URL(eventRequests.at(-1)!).searchParams.get("page")).toBe("2");
  2143 |     await page.getByRole("button", { name: "Newer" }).click();
  2144 |     await expect(page.getByText("Page 1.", { exact: false })).toBeVisible();
  2145 |     await expect(
  2146 |       page.getByText("Filtered release event 0", { exact: true }),
  2147 |     ).toBeVisible();
  2148 | 
  2149 |     await page.getByPlaceholder("Search logs...").fill("Filtered release");
  2150 |     await page.getByRole("button", { name: "Toggle event filters" }).click();
  2151 |     await page.locator("select").nth(1).selectOption("success");
  2152 |     await expect(
  2153 |       page.getByText("Filtered release event 0", { exact: true }),
  2154 |     ).toBeVisible();
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
> 2230 |     expect(visibleText).toContain("The required analysis did not complete.");
       |                         ^ Error: expect(received).toContain(expected) // indexOf
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
```