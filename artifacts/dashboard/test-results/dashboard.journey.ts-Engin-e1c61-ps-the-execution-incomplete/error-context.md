# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: dashboard.journey.ts >> EngineeringOS dashboard browser journey >> resumes a failed analysis and keeps the execution incomplete
- Location: e2e/dashboard.journey.ts:2104:3

# Error details

```
Error: locator.click: Error: strict mode violation: getByRole('button', { name: 'Resume', exact: true }) resolved to 2 elements:
    1) <button type="button" data-component-name="Comp" data-replit-metadata="artifacts/dashboard/src/components/ui/button.tsx:54:6" class="inline-flex items-center justify-center gap-2 whitespace-nowrap font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0 hover-elevate active-elevate-2 border [border-color:var(--button-outline)] shadow-xs active:shadow…>…</button> aka getByLabel('Agent execution proof').getByRole('button', { name: 'Resume' })
    2) <button data-component-name="Comp" data-replit-metadata="artifacts/dashboard/src/components/ui/button.tsx:54:6" class="inline-flex items-center justify-center gap-2 whitespace-nowrap font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0 hover-elevate active-elevate-2 border [border-color:var(--button-outline)] shadow-xs active:shadow-none min-h-8 …>…</button> aka getByRole('button', { name: 'Resume' }).nth(1)

Call log:
  - waiting for getByRole('button', { name: 'Resume', exact: true })

```

```
Error: page.waitForRequest: Test ended.
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
            - button "Verify the analysis evidence after reconnect." [ref=f2e106]
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
              - generic "Agent execution proof" [ref=f2e165]:
                - generic [ref=f2e170]:
                  - generic [ref=f2e171]:
                    - generic [ref=f2e172]: Agent execution proof
                    - generic [ref=f2e173]: Preparing
                    - generic [ref=f2e174]: "Evidence: INCOMPLETE"
                    - generic [ref=f2e175]: Persisted proof
                    - button "Resume" [ref=f2e177]
                  - paragraph [ref=f2e178]: Execution paused — ready to resume from its durable checkpoint
                  - generic [ref=f2e179]:
                    - generic [ref=f2e180]:
                      - text: "Phase:"
                      - strong [ref=f2e181]: tool-execution
                    - generic [ref=f2e182]:
                      - text: "Attempt:"
                      - strong [ref=f2e183]: "0"
                    - generic [ref=f2e184]:
                      - text: "Revision:"
                      - code [ref=f2e185]: not recorded
                  - generic [ref=f2e186]:
                    - code [ref=f2e187]: Execution e2e-resumed-analysis-failure-execution
                    - link "Open execution in Flight Deck" [ref=f2e188] [cursor=pointer]:
                      - /url: /dashboard/flight-deck?executionId=e2e-resumed-analysis-failure-execution
                      - text: Flight Deck
                  - paragraph [ref=f2e193]: The required analysis did not complete.
                - generic [ref=f2e194]:
                  - generic [ref=f2e195]:
                    - generic [ref=f2e196]: Evidence
                    - generic [ref=f2e197]: Evidence pending
                  - generic [ref=f2e198]:
                    - generic [ref=f2e199]: Agent work
                    - generic [ref=f2e200]: 0/0 tools
                  - generic [ref=f2e201]:
                    - generic [ref=f2e202]: Delivery
                    - generic [ref=f2e203]: No writes applied automatically
                  - generic [ref=f2e204]:
                    - generic [ref=f2e205]: Safety
                    - generic [ref=f2e206]: No automatic writes
                - generic [ref=f2e207]:
                  - generic [ref=f2e208]:
                    - generic [ref=f2e209]: Objective
                    - generic [ref=f2e210]: Verify the analysis evidence after reconnect.
                  - generic [ref=f2e211]:
                    - generic [ref=f2e212]: Scope
                    - generic [ref=f2e213]: 0 files · 0 nodes
                  - generic [ref=f2e214]:
                    - generic [ref=f2e215]: Risk
                    - generic [ref=f2e216]: No unresolved patch risk recorded
                - generic [ref=f2e217]:
                  - generic [ref=f2e218]: checkpoint v1
                  - generic [ref=f2e219]: resume available
              - generic [ref=f2e220]: Verify the analysis evidence after reconnect.
              - generic [ref=f2e232]:
                - generic [ref=f2e233]:
                  - generic [ref=f2e234]: "ANALYSIS_INCOMPLETE: The required analysis did not complete, so no verified result is available."
                  - generic [ref=f2e235]:
                    - generic [ref=f2e236]: Execution failed
                    - generic [ref=f2e237]: Provider failure
                    - generic [ref=f2e238]: The required analysis did not complete.
                    - generic [ref=f2e239]: "Durable execution: e2e-resumed-analysis-failure-execution"
                - button "Forensic evidence INCOMPLETE" [ref=f2e241]:
                  - generic [ref=f2e244]: Forensic evidence
                  - generic [ref=f2e245]: INCOMPLETE
            - generic [ref=f2e248]:
              - generic [ref=f2e249]:
                - generic [ref=f2e250]:
                  - generic [ref=f2e251]: A saved AI execution is ready to resume
                  - generic [ref=f2e252]: Execution e2e-resu… · no file changes were applied automatically · checkpoint 1
                - button "Resume" [ref=f2e254]
              - generic [ref=f2e255]:
                - textbox "Ask about your codebase, tasks, or metrics… (Enter to send)" [ref=f2e256]
                - button [disabled]
  - region "Notifications (F8)":
    - list
```

# Test source

```ts
  2044 |     ).toBeVisible();
  2045 | 
  2046 |     const reloadedText = await page.locator("body").innerText();
  2047 |     await expectNoHorizontalOverflow(page);
  2048 |     expect(reloadedText).not.toMatch(
  2049 |       /raw exception|stack trace|\/home\/runner|secret|fixture diagnostic/i,
  2050 |     );
  2051 |   });
  2052 | 
  2053 |   test("preserves one partial answer after a provider disconnect and marks it incomplete", async ({
  2054 |     page,
  2055 |   }) => {
  2056 |     const fixture = await installArabicAiFixture(page);
  2057 |     await installApiFixtures(page, { arabicAi: fixture });
  2058 |     await programmaticSignIn(page);
  2059 |     await page.goto(`${DASHBOARD_PATH}ai`);
  2060 | 
  2061 |     const composer = page.locator("textarea").first();
  2062 |     await composer.fill(fixture.question);
  2063 |     await composer.locator("xpath=..").getByRole("button").click();
  2064 | 
  2065 |     const answer = page.getByText(fixture.answer, { exact: true });
  2066 |     await expect(answer).toHaveCount(1);
  2067 |     await expect(answer).toBeVisible();
  2068 |     await expect(page.getByText("INCOMPLETE:", { exact: false })).toBeVisible();
  2069 |     await expect(
  2070 |       page.getByText("provider failure", { exact: false }).last(),
  2071 |     ).toBeVisible();
  2072 |     await expect(
  2073 |       page.getByText("stopped: provider timeout", { exact: false }).last(),
  2074 |     ).toBeVisible();
  2075 |     await expect(
  2076 |       page.getByText("The provider disconnected after visible response text.", {
  2077 |         exact: true,
  2078 |       }),
  2079 |     ).toBeVisible();
  2080 | 
  2081 |     await page.reload();
  2082 |     await page
  2083 |       .getByRole("button", { name: fixture.question, exact: true })
  2084 |       .click();
  2085 | 
  2086 |     await expect(page.getByText(fixture.answer, { exact: true })).toHaveCount(
  2087 |       1,
  2088 |     );
  2089 |     await expect(page.getByText(fixture.answer, { exact: true })).toBeVisible();
  2090 |     await expect(page.getByText("INCOMPLETE:", { exact: false })).toBeVisible();
  2091 |     await expect(
  2092 |       page.getByText("provider failure", { exact: false }).last(),
  2093 |     ).toBeVisible();
  2094 |     await expect(
  2095 |       page.getByText("stopped: provider timeout", { exact: false }).last(),
  2096 |     ).toBeVisible();
  2097 |     await expect(
  2098 |       page.getByText("The provider disconnected after visible response text.", {
  2099 |         exact: true,
  2100 |       }),
  2101 |     ).toBeVisible();
  2102 |   });
  2103 | 
  2104 |   test("resumes a failed analysis and keeps the execution incomplete", async ({
  2105 |     page,
  2106 |   }) => {
  2107 |     const { fixture, execution } = installResumedAnalysisFailureFixture();
  2108 |     await installApiFixtures(page, {
  2109 |       arabicAi: fixture,
  2110 |       resumeFailure: { fixture, execution },
  2111 |     });
  2112 |     await programmaticSignIn(page);
  2113 | 
  2114 |     await page.evaluate(
  2115 |       ({ sessionId, executionId, projectId, resumeToken, message }) => {
  2116 |         localStorage.setItem(
  2117 |           `eos_ai_execution_current_${projectId}`,
  2118 |           sessionId,
  2119 |         );
  2120 |         localStorage.setItem(
  2121 |           `eos_ai_execution_${projectId}_${sessionId}`,
  2122 |           JSON.stringify({
  2123 |             id: executionId,
  2124 |             projectId,
  2125 |             sessionId,
  2126 |             resumeToken,
  2127 |             message,
  2128 |           }),
  2129 |         );
  2130 |       },
  2131 |       {
  2132 |         sessionId: fixture.sessionId,
  2133 |         executionId: fixture.executionId,
  2134 |         projectId: "e2e-project",
  2135 |         resumeToken: "e2e-resumed-analysis-failure-token-opaque",
  2136 |         message: fixture.question,
  2137 |       },
  2138 |     );
  2139 |     await page.goto(`${DASHBOARD_PATH}ai`);
  2140 | 
  2141 |     await expect(
  2142 |       page.getByText("A saved AI execution is ready to resume"),
  2143 |     ).toBeVisible();
> 2144 |     const resumeRequest = page.waitForRequest(
       |                                ^ Error: page.waitForRequest: Test ended.
  2145 |       (request) =>
  2146 |         request.url().includes("/api/ai/chat/stream") &&
  2147 |         request.method() === "POST",
  2148 |     );
  2149 |     await page.getByRole("button", { name: "Resume", exact: true }).click();
  2150 |     const requestBody = JSON.parse(
  2151 |       (await resumeRequest).postData() ?? "{}",
  2152 |     ) as Record<string, unknown>;
  2153 |     expect(requestBody).toEqual(
  2154 |       expect.objectContaining({
  2155 |         projectId: "e2e-project",
  2156 |         sessionId: fixture.sessionId,
  2157 |         executionId: fixture.executionId,
  2158 |         resumeToken: "e2e-resumed-analysis-failure-token-opaque",
  2159 |         message: fixture.question,
  2160 |       }),
  2161 |     );
  2162 | 
  2163 |     await expect(
  2164 |       page.getByText("Failed to send message", { exact: true }),
  2165 |     ).toBeVisible();
  2166 |     await expect(
  2167 |       page.getByText("A saved AI execution is ready to resume"),
  2168 |     ).toBeVisible();
  2169 |     const visibleText = await page.locator("body").innerText();
  2170 |     expect(visibleText).not.toContain("COMPLETED");
  2171 |     expect(visibleText).not.toContain("Persisted execution proof");
  2172 |     expect(visibleText).toContain("The required analysis did not complete.");
  2173 |   });
  2174 | 
  2175 |   test("recovers a missing token after a real stream abort and resumes one execution", async ({
  2176 |     page,
  2177 |   }) => {
  2178 |     const recovery = installInterruptedResumeFixture();
  2179 |     await installApiFixtures(page, { interruptedResume: recovery });
  2180 |     await page.addInitScript(() => {
  2181 |       const nativeFetch = window.fetch.bind(window);
  2182 |       window.fetch = async (input, init) => {
  2183 |         const url = typeof input === "string"
  2184 |           ? input
  2185 |           : input instanceof Request
  2186 |             ? input.url
  2187 |             : String(input);
  2188 |         const body = typeof init?.body === "string" ? init.body : "";
  2189 |         if (!url.includes("/api/ai/chat/stream") || body.includes('"executionId"')) {
  2190 |           return nativeFetch(input, init);
  2191 |         }
  2192 | 
  2193 |         const response = await nativeFetch(input, init);
  2194 |         if (!response.body) return response;
  2195 |         const reader = response.body.getReader();
  2196 |         const encoder = new TextEncoder();
  2197 |         const stream = new ReadableStream({
  2198 |           async start(controller) {
  2199 |             let buffered = "";
  2200 |             while (true) {
  2201 |               const { done, value } = await reader.read();
  2202 |               if (done) {
  2203 |                 if (buffered) controller.enqueue(encoder.encode(buffered));
  2204 |                 controller.close();
  2205 |                 return;
  2206 |               }
  2207 |               buffered += new TextDecoder().decode(value, { stream: true });
  2208 |               const marker = buffered.indexOf('"type":"execution_started"');
  2209 |               const frameEnd = marker < 0 ? -1 : buffered.indexOf("\n\n", marker);
  2210 |               if (frameEnd >= 0) {
  2211 |                 controller.enqueue(encoder.encode(buffered.slice(0, frameEnd + 2)));
  2212 |                 controller.error(new TypeError("network connection reset"));
  2213 |                 return;
  2214 |               }
  2215 |             }
  2216 |           },
  2217 |         });
  2218 |         return new Response(stream, {
  2219 |           status: response.status,
  2220 |           statusText: response.statusText,
  2221 |           headers: response.headers,
  2222 |         });
  2223 |       };
  2224 |     });
  2225 |     await programmaticSignIn(page);
  2226 |     await page.goto(`${DASHBOARD_PATH}ai`);
  2227 | 
  2228 |     const streamRequests: Array<Record<string, unknown>> = [];
  2229 |     page.on("request", (request) => {
  2230 |       if (
  2231 |         request.url().includes("/api/ai/chat/stream") &&
  2232 |         request.method() === "POST"
  2233 |       ) {
  2234 |         try {
  2235 |           streamRequests.push(request.postDataJSON() as Record<string, unknown>);
  2236 |         } catch {
  2237 |           // Ignore requests without a JSON body; the assertions below require
  2238 |           // both journey requests to have a valid request envelope.
  2239 |         }
  2240 |       }
  2241 |     });
  2242 | 
  2243 |     const composer = page.locator("textarea").first();
  2244 |     await composer.fill(recovery.fixture.question);
```