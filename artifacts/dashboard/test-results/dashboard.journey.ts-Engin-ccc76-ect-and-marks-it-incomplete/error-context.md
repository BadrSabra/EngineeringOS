# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: dashboard.journey.ts >> EngineeringOS dashboard browser journey >> preserves one partial answer after a provider disconnect and marks it incomplete
- Location: e2e/dashboard.journey.ts:2053:3

# Error details

```
Error: expect(locator).toHaveCount(expected) failed

Locator:  getByText('عند انتهاء مهلة مزود الذكاء الاصطناعي، يعيد المسار تقريرًا جزئيًا من الأدلة التي جُمعت بدل إصدار Finding غير مثبت.', { exact: true })
Expected: 1
Received: 2
Timeout:  10000ms

Call log:
  - Expect "toHaveCount" with timeout 10000ms
  - waiting for getByText('عند انتهاء مهلة مزود الذكاء الاصطناعي، يعيد المسار تقريرًا جزئيًا من الأدلة التي جُمعت بدل إصدار Finding غير مثبت.', { exact: true })
    24 × locator resolved to 2 elements
       - unexpected value "2"

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
                  - generic "Agent activity · 1 events" [ref=f2e254] [cursor=pointer]:
                    - generic [ref=f2e257]: Agent activity
                    - generic [ref=f2e258]: · 1 events
                - button "Forensic evidence NOT PROVEN" [ref=f2e262]:
                  - generic [ref=f2e265]: Forensic evidence
                  - generic [ref=f2e266]: NOT PROVEN
            - generic [ref=f2e270]:
              - textbox "Ask about your codebase, tasks, or metrics… (Enter to send)" [ref=f2e271]
              - button [disabled]
  - region "Notifications (F8)":
    - list
```

# Test source

```ts
  1966 |     await page.goto(`${DASHBOARD_PATH}ai`);
  1967 | 
  1968 |     const composer = page.locator("textarea").first();
  1969 |     await composer.fill(fixture.question);
  1970 |     await composer.locator("xpath=..").getByRole("button").click();
  1971 | 
  1972 |     await expect(
  1973 |       page.getByText(fixture.answer, { exact: true }).last(),
  1974 |     ).toBeVisible();
  1975 |     await expect(
  1976 |       page
  1977 |         .getByText("required tool did not complete — BLOCKED/INCOMPLETE", {
  1978 |           exact: false,
  1979 |         })
  1980 |         .last(),
  1981 |     ).toBeVisible();
  1982 |     await page
  1983 |       .locator("summary")
  1984 |       .filter({ hasText: "Agent activity" })
  1985 |       .last()
  1986 |       .click();
  1987 |     await expect(page.locator("body")).toContainText("Reading source");
  1988 |     await expect(page.locator("body")).toContainText(
  1989 |       "src/missing-release-fixture.ts",
  1990 |     );
  1991 |     await expect(page.locator("body")).toContainText("Tool failed");
  1992 |     await expect(page.locator("body")).toContainText("TOOL_EXECUTION_FAILED");
  1993 |     await page
  1994 |       .locator("summary")
  1995 |       .filter({ hasText: "Persisted execution proof" })
  1996 |       .last()
  1997 |       .click();
  1998 |     await expect(
  1999 |       page
  2000 |         .getByText("required tool failed — operation blocked", { exact: true })
  2001 |         .last(),
  2002 |     ).toBeVisible();
  2003 | 
  2004 |     const visibleText = await page.locator("body").innerText();
  2005 |     expect(visibleText).not.toMatch(
  2006 |       /raw exception|stack trace|\/home\/runner|secret|fixture diagnostic/i,
  2007 |     );
  2008 | 
  2009 |     await page.reload();
  2010 |     await page
  2011 |       .getByRole("button", { name: fixture.question, exact: true })
  2012 |       .click();
  2013 | 
  2014 |     await expect(
  2015 |       page.getByText(fixture.answer, { exact: true }).last(),
  2016 |     ).toBeVisible();
  2017 |     await expect(
  2018 |       page
  2019 |         .getByText("required tool did not complete — BLOCKED/INCOMPLETE", {
  2020 |           exact: false,
  2021 |         })
  2022 |         .last(),
  2023 |     ).toBeVisible();
  2024 |     await page
  2025 |       .locator("summary")
  2026 |       .filter({ hasText: "Agent activity" })
  2027 |       .last()
  2028 |       .click();
  2029 |     await expect(page.locator("body")).toContainText("Reading source");
  2030 |     await expect(page.locator("body")).toContainText(
  2031 |       "src/missing-release-fixture.ts",
  2032 |     );
  2033 |     await expect(page.locator("body")).toContainText("Tool failed");
  2034 |     await expect(page.locator("body")).toContainText("TOOL_EXECUTION_FAILED");
  2035 |     await page
  2036 |       .locator("summary")
  2037 |       .filter({ hasText: "Persisted execution proof" })
  2038 |       .last()
  2039 |       .click();
  2040 |     await expect(
  2041 |       page
  2042 |         .getByText("required tool failed — operation blocked", { exact: true })
  2043 |         .last(),
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
> 2066 |     await expect(answer).toHaveCount(1);
       |                          ^ Error: expect(locator).toHaveCount(expected) failed
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
  2144 |     const resumeRequest = page.waitForRequest(
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
```