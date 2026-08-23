# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: dashboard.journey.ts >> EngineeringOS dashboard browser journey >> resumes a failed analysis and keeps the execution incomplete
- Location: e2e/dashboard.journey.ts:2088:3

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
                    - generic [ref=f2e176]:
                      - button "Export audit" [ref=f2e177]
                      - button "Resume" [ref=f2e178]
                  - paragraph [ref=f2e179]: Execution paused — ready to resume from its durable checkpoint
                  - generic [ref=f2e180]:
                    - generic [ref=f2e181]:
                      - text: "Phase:"
                      - strong [ref=f2e182]: tool-execution
                    - generic [ref=f2e183]:
                      - text: "Attempt:"
                      - strong [ref=f2e184]: "0"
                    - generic [ref=f2e185]:
                      - text: "Revision:"
                      - code [ref=f2e186]: not recorded
                  - generic [ref=f2e187]:
                    - code [ref=f2e188]: Execution e2e-resumed-analysis-failure-execution
                    - link "Open execution in Flight Deck" [ref=f2e189] [cursor=pointer]:
                      - /url: /dashboard/flight-deck?executionId=e2e-resumed-analysis-failure-execution
                      - text: Flight Deck
                  - paragraph [ref=f2e194]: The required analysis did not complete.
                - generic [ref=f2e195]:
                  - generic [ref=f2e196]:
                    - generic [ref=f2e197]: Evidence
                    - generic [ref=f2e198]: Evidence pending
                  - generic [ref=f2e199]:
                    - generic [ref=f2e200]: Agent work
                    - generic [ref=f2e201]: 0/0 tools
                  - generic [ref=f2e202]:
                    - generic [ref=f2e203]: Delivery
                    - generic [ref=f2e204]: No writes applied automatically
                  - generic [ref=f2e205]:
                    - generic [ref=f2e206]: Safety
                    - generic [ref=f2e207]: No automatic writes
                - generic [ref=f2e208]:
                  - generic [ref=f2e209]:
                    - generic [ref=f2e210]: Objective
                    - generic [ref=f2e211]: Verify the analysis evidence after reconnect.
                  - generic [ref=f2e212]:
                    - generic [ref=f2e213]: Scope
                    - generic [ref=f2e214]: 0 files · 0 nodes
                  - generic [ref=f2e215]:
                    - generic [ref=f2e216]: Risk
                    - generic [ref=f2e217]: No unresolved patch risk recorded
                - generic [ref=f2e218]:
                  - generic [ref=f2e219]: checkpoint v1
                  - generic [ref=f2e220]: resume available
              - generic [ref=f2e221]: Verify the analysis evidence after reconnect.
              - generic [ref=f2e233]:
                - generic [ref=f2e234]:
                  - generic [ref=f2e235]: "ANALYSIS_INCOMPLETE: The required analysis did not complete, so no verified result is available."
                  - generic [ref=f2e236]:
                    - generic [ref=f2e237]: Execution failed
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
  2028 |     ).toBeVisible();
  2029 | 
  2030 |     const reloadedText = await page.locator("body").innerText();
  2031 |     await expectNoHorizontalOverflow(page);
  2032 |     expect(reloadedText).not.toMatch(
  2033 |       /raw exception|stack trace|\/home\/runner|secret|fixture diagnostic/i,
  2034 |     );
  2035 |   });
  2036 | 
  2037 |   test("preserves one partial answer after a provider disconnect and marks it incomplete", async ({
  2038 |     page,
  2039 |   }) => {
  2040 |     const fixture = await installArabicAiFixture(page);
  2041 |     await installApiFixtures(page, { arabicAi: fixture });
  2042 |     await programmaticSignIn(page);
  2043 |     await page.goto(`${DASHBOARD_PATH}ai`);
  2044 | 
  2045 |     const composer = page.locator("textarea").first();
  2046 |     await composer.fill(fixture.question);
  2047 |     await composer.locator("xpath=..").getByRole("button").click();
  2048 | 
  2049 |     const answer = page.getByText(fixture.answer, { exact: true });
  2050 |     await expect(answer).toHaveCount(1);
  2051 |     await expect(answer).toBeVisible();
  2052 |     await expect(page.getByText("INCOMPLETE:", { exact: false })).toBeVisible();
  2053 |     await expect(
  2054 |       page.getByText("provider failure", { exact: false }).last(),
  2055 |     ).toBeVisible();
  2056 |     await expect(
  2057 |       page.getByText("stopped: provider timeout", { exact: false }).last(),
  2058 |     ).toBeVisible();
  2059 |     await expect(
  2060 |       page.getByText("The provider disconnected after visible response text.", {
  2061 |         exact: true,
  2062 |       }),
  2063 |     ).toBeVisible();
  2064 | 
  2065 |     await page.reload();
  2066 |     await page
  2067 |       .getByRole("button", { name: fixture.question, exact: true })
  2068 |       .click();
  2069 | 
  2070 |     await expect(page.getByText(fixture.answer, { exact: true })).toHaveCount(
  2071 |       1,
  2072 |     );
  2073 |     await expect(page.getByText(fixture.answer, { exact: true })).toBeVisible();
  2074 |     await expect(page.getByText("INCOMPLETE:", { exact: false })).toBeVisible();
  2075 |     await expect(
  2076 |       page.getByText("provider failure", { exact: false }).last(),
  2077 |     ).toBeVisible();
  2078 |     await expect(
  2079 |       page.getByText("stopped: provider timeout", { exact: false }).last(),
  2080 |     ).toBeVisible();
  2081 |     await expect(
  2082 |       page.getByText("The provider disconnected after visible response text.", {
  2083 |         exact: true,
  2084 |       }),
  2085 |     ).toBeVisible();
  2086 |   });
  2087 | 
  2088 |   test("resumes a failed analysis and keeps the execution incomplete", async ({
  2089 |     page,
  2090 |   }) => {
  2091 |     const { fixture, execution } = installResumedAnalysisFailureFixture();
  2092 |     await installApiFixtures(page, {
  2093 |       arabicAi: fixture,
  2094 |       resumeFailure: { fixture, execution },
  2095 |     });
  2096 |     await programmaticSignIn(page);
  2097 | 
  2098 |     await page.evaluate(
  2099 |       ({ sessionId, executionId, projectId, resumeToken, message }) => {
  2100 |         localStorage.setItem(
  2101 |           `eos_ai_execution_current_${projectId}`,
  2102 |           sessionId,
  2103 |         );
  2104 |         localStorage.setItem(
  2105 |           `eos_ai_execution_${projectId}_${sessionId}`,
  2106 |           JSON.stringify({
  2107 |             id: executionId,
  2108 |             projectId,
  2109 |             sessionId,
  2110 |             resumeToken,
  2111 |             message,
  2112 |           }),
  2113 |         );
  2114 |       },
  2115 |       {
  2116 |         sessionId: fixture.sessionId,
  2117 |         executionId: fixture.executionId,
  2118 |         projectId: "e2e-project",
  2119 |         resumeToken: "e2e-resumed-analysis-failure-token-opaque",
  2120 |         message: fixture.question,
  2121 |       },
  2122 |     );
  2123 |     await page.goto(`${DASHBOARD_PATH}ai`);
  2124 | 
  2125 |     await expect(
  2126 |       page.getByText("A saved AI execution is ready to resume"),
  2127 |     ).toBeVisible();
> 2128 |     const resumeRequest = page.waitForRequest(
       |                                ^ Error: page.waitForRequest: Test ended.
  2129 |       (request) =>
  2130 |         request.url().includes("/api/ai/chat/stream") &&
  2131 |         request.method() === "POST",
  2132 |     );
  2133 |     await page.getByRole("button", { name: "Resume", exact: true }).click();
  2134 |     const requestBody = JSON.parse(
  2135 |       (await resumeRequest).postData() ?? "{}",
  2136 |     ) as Record<string, unknown>;
  2137 |     expect(requestBody).toEqual(
  2138 |       expect.objectContaining({
  2139 |         projectId: "e2e-project",
  2140 |         sessionId: fixture.sessionId,
  2141 |         executionId: fixture.executionId,
  2142 |         resumeToken: "e2e-resumed-analysis-failure-token-opaque",
  2143 |         message: fixture.question,
  2144 |       }),
  2145 |     );
  2146 | 
  2147 |     await expect(
  2148 |       page.getByText("Failed to send message", { exact: true }),
  2149 |     ).toBeVisible();
  2150 |     await expect(
  2151 |       page.getByText("A saved AI execution is ready to resume"),
  2152 |     ).toBeVisible();
  2153 |     const visibleText = await page.locator("body").innerText();
  2154 |     expect(visibleText).not.toContain("COMPLETED");
  2155 |     expect(visibleText).not.toContain("Persisted execution proof");
  2156 |     expect(visibleText).toContain("The required analysis did not complete.");
  2157 |   });
  2158 | 
  2159 |   test("recovers a missing token after a real stream abort and resumes one execution", async ({
  2160 |     page,
  2161 |   }) => {
  2162 |     const recovery = installInterruptedResumeFixture();
  2163 |     await installApiFixtures(page, { interruptedResume: recovery });
  2164 |     await page.addInitScript(() => {
  2165 |       const nativeFetch = window.fetch.bind(window);
  2166 |       window.fetch = async (input, init) => {
  2167 |         const url = typeof input === "string"
  2168 |           ? input
  2169 |           : input instanceof Request
  2170 |             ? input.url
  2171 |             : String(input);
  2172 |         const body = typeof init?.body === "string" ? init.body : "";
  2173 |         if (!url.includes("/api/ai/chat/stream") || body.includes('"executionId"')) {
  2174 |           return nativeFetch(input, init);
  2175 |         }
  2176 | 
  2177 |         const response = await nativeFetch(input, init);
  2178 |         if (!response.body) return response;
  2179 |         const reader = response.body.getReader();
  2180 |         const encoder = new TextEncoder();
  2181 |         const stream = new ReadableStream({
  2182 |           async start(controller) {
  2183 |             let buffered = "";
  2184 |             while (true) {
  2185 |               const { done, value } = await reader.read();
  2186 |               if (done) {
  2187 |                 if (buffered) controller.enqueue(encoder.encode(buffered));
  2188 |                 controller.close();
  2189 |                 return;
  2190 |               }
  2191 |               buffered += new TextDecoder().decode(value, { stream: true });
  2192 |               const marker = buffered.indexOf('"type":"execution_started"');
  2193 |               const frameEnd = marker < 0 ? -1 : buffered.indexOf("\n\n", marker);
  2194 |               if (frameEnd >= 0) {
  2195 |                 controller.enqueue(encoder.encode(buffered.slice(0, frameEnd + 2)));
  2196 |                 controller.error(new TypeError("network connection reset"));
  2197 |                 return;
  2198 |               }
  2199 |             }
  2200 |           },
  2201 |         });
  2202 |         return new Response(stream, {
  2203 |           status: response.status,
  2204 |           statusText: response.statusText,
  2205 |           headers: response.headers,
  2206 |         });
  2207 |       };
  2208 |     });
  2209 |     await programmaticSignIn(page);
  2210 |     await page.goto(`${DASHBOARD_PATH}ai`);
  2211 | 
  2212 |     const streamRequests: Array<Record<string, unknown>> = [];
  2213 |     page.on("request", (request) => {
  2214 |       if (
  2215 |         request.url().includes("/api/ai/chat/stream") &&
  2216 |         request.method() === "POST"
  2217 |       ) {
  2218 |         try {
  2219 |           streamRequests.push(request.postDataJSON() as Record<string, unknown>);
  2220 |         } catch {
  2221 |           // Ignore requests without a JSON body; the assertions below require
  2222 |           // both journey requests to have a valid request envelope.
  2223 |         }
  2224 |       }
  2225 |     });
  2226 | 
  2227 |     const composer = page.locator("textarea").first();
  2228 |     await composer.fill(recovery.fixture.question);
```