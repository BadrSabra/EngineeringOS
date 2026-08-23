# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: dashboard.journey.ts >> EngineeringOS dashboard browser journey >> preserves one partial answer after a provider disconnect and marks it incomplete
- Location: e2e/dashboard.journey.ts:2037:3

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
    23 × locator resolved to 2 elements
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
  1950 |     await page.goto(`${DASHBOARD_PATH}ai`);
  1951 | 
  1952 |     const composer = page.locator("textarea").first();
  1953 |     await composer.fill(fixture.question);
  1954 |     await composer.locator("xpath=..").getByRole("button").click();
  1955 | 
  1956 |     await expect(
  1957 |       page.getByText(fixture.answer, { exact: true }).last(),
  1958 |     ).toBeVisible();
  1959 |     await expect(
  1960 |       page
  1961 |         .getByText("required tool did not complete — BLOCKED/INCOMPLETE", {
  1962 |           exact: false,
  1963 |         })
  1964 |         .last(),
  1965 |     ).toBeVisible();
  1966 |     await page
  1967 |       .locator("summary")
  1968 |       .filter({ hasText: "Agent activity" })
  1969 |       .last()
  1970 |       .click();
  1971 |     await expect(page.locator("body")).toContainText("Reading source");
  1972 |     await expect(page.locator("body")).toContainText(
  1973 |       "src/missing-release-fixture.ts",
  1974 |     );
  1975 |     await expect(page.locator("body")).toContainText("Tool failed");
  1976 |     await expect(page.locator("body")).toContainText("TOOL_EXECUTION_FAILED");
  1977 |     await page
  1978 |       .locator("summary")
  1979 |       .filter({ hasText: "Persisted execution proof" })
  1980 |       .last()
  1981 |       .click();
  1982 |     await expect(
  1983 |       page
  1984 |         .getByText("required tool failed — operation blocked", { exact: true })
  1985 |         .last(),
  1986 |     ).toBeVisible();
  1987 | 
  1988 |     const visibleText = await page.locator("body").innerText();
  1989 |     expect(visibleText).not.toMatch(
  1990 |       /raw exception|stack trace|\/home\/runner|secret|fixture diagnostic/i,
  1991 |     );
  1992 | 
  1993 |     await page.reload();
  1994 |     await page
  1995 |       .getByRole("button", { name: fixture.question, exact: true })
  1996 |       .click();
  1997 | 
  1998 |     await expect(
  1999 |       page.getByText(fixture.answer, { exact: true }).last(),
  2000 |     ).toBeVisible();
  2001 |     await expect(
  2002 |       page
  2003 |         .getByText("required tool did not complete — BLOCKED/INCOMPLETE", {
  2004 |           exact: false,
  2005 |         })
  2006 |         .last(),
  2007 |     ).toBeVisible();
  2008 |     await page
  2009 |       .locator("summary")
  2010 |       .filter({ hasText: "Agent activity" })
  2011 |       .last()
  2012 |       .click();
  2013 |     await expect(page.locator("body")).toContainText("Reading source");
  2014 |     await expect(page.locator("body")).toContainText(
  2015 |       "src/missing-release-fixture.ts",
  2016 |     );
  2017 |     await expect(page.locator("body")).toContainText("Tool failed");
  2018 |     await expect(page.locator("body")).toContainText("TOOL_EXECUTION_FAILED");
  2019 |     await page
  2020 |       .locator("summary")
  2021 |       .filter({ hasText: "Persisted execution proof" })
  2022 |       .last()
  2023 |       .click();
  2024 |     await expect(
  2025 |       page
  2026 |         .getByText("required tool failed — operation blocked", { exact: true })
  2027 |         .last(),
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
> 2050 |     await expect(answer).toHaveCount(1);
       |                          ^ Error: expect(locator).toHaveCount(expected) failed
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
  2128 |     const resumeRequest = page.waitForRequest(
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
```