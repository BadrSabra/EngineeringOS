# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: dashboard.journey.ts >> EngineeringOS dashboard browser journey >> preserves one partial answer after a provider disconnect and marks it incomplete
- Location: e2e/dashboard.journey.ts:2032:3

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
  1945 |     await page.goto(`${DASHBOARD_PATH}ai`);
  1946 | 
  1947 |     const composer = page.locator("textarea").first();
  1948 |     await composer.fill(fixture.question);
  1949 |     await composer.locator("xpath=..").getByRole("button").click();
  1950 | 
  1951 |     await expect(
  1952 |       page.getByText(fixture.answer, { exact: true }).last(),
  1953 |     ).toBeVisible();
  1954 |     await expect(
  1955 |       page
  1956 |         .getByText("required tool did not complete — BLOCKED/INCOMPLETE", {
  1957 |           exact: false,
  1958 |         })
  1959 |         .last(),
  1960 |     ).toBeVisible();
  1961 |     await page
  1962 |       .locator("summary")
  1963 |       .filter({ hasText: "Agent activity" })
  1964 |       .last()
  1965 |       .click();
  1966 |     await expect(page.locator("body")).toContainText("Reading source");
  1967 |     await expect(page.locator("body")).toContainText(
  1968 |       "src/missing-release-fixture.ts",
  1969 |     );
  1970 |     await expect(page.locator("body")).toContainText("Tool failed");
  1971 |     await expect(page.locator("body")).toContainText("TOOL_EXECUTION_FAILED");
  1972 |     await page
  1973 |       .locator("summary")
  1974 |       .filter({ hasText: "Persisted execution proof" })
  1975 |       .last()
  1976 |       .click();
  1977 |     await expect(
  1978 |       page
  1979 |         .getByText("required tool failed — operation blocked", { exact: true })
  1980 |         .last(),
  1981 |     ).toBeVisible();
  1982 | 
  1983 |     const visibleText = await page.locator("body").innerText();
  1984 |     expect(visibleText).not.toMatch(
  1985 |       /raw exception|stack trace|\/home\/runner|secret|fixture diagnostic/i,
  1986 |     );
  1987 | 
  1988 |     await page.reload();
  1989 |     await page
  1990 |       .getByRole("button", { name: fixture.question, exact: true })
  1991 |       .click();
  1992 | 
  1993 |     await expect(
  1994 |       page.getByText(fixture.answer, { exact: true }).last(),
  1995 |     ).toBeVisible();
  1996 |     await expect(
  1997 |       page
  1998 |         .getByText("required tool did not complete — BLOCKED/INCOMPLETE", {
  1999 |           exact: false,
  2000 |         })
  2001 |         .last(),
  2002 |     ).toBeVisible();
  2003 |     await page
  2004 |       .locator("summary")
  2005 |       .filter({ hasText: "Agent activity" })
  2006 |       .last()
  2007 |       .click();
  2008 |     await expect(page.locator("body")).toContainText("Reading source");
  2009 |     await expect(page.locator("body")).toContainText(
  2010 |       "src/missing-release-fixture.ts",
  2011 |     );
  2012 |     await expect(page.locator("body")).toContainText("Tool failed");
  2013 |     await expect(page.locator("body")).toContainText("TOOL_EXECUTION_FAILED");
  2014 |     await page
  2015 |       .locator("summary")
  2016 |       .filter({ hasText: "Persisted execution proof" })
  2017 |       .last()
  2018 |       .click();
  2019 |     await expect(
  2020 |       page
  2021 |         .getByText("required tool failed — operation blocked", { exact: true })
  2022 |         .last(),
  2023 |     ).toBeVisible();
  2024 | 
  2025 |     const reloadedText = await page.locator("body").innerText();
  2026 |     await expectNoHorizontalOverflow(page);
  2027 |     expect(reloadedText).not.toMatch(
  2028 |       /raw exception|stack trace|\/home\/runner|secret|fixture diagnostic/i,
  2029 |     );
  2030 |   });
  2031 | 
  2032 |   test("preserves one partial answer after a provider disconnect and marks it incomplete", async ({
  2033 |     page,
  2034 |   }) => {
  2035 |     const fixture = await installArabicAiFixture(page);
  2036 |     await installApiFixtures(page, { arabicAi: fixture });
  2037 |     await programmaticSignIn(page);
  2038 |     await page.goto(`${DASHBOARD_PATH}ai`);
  2039 | 
  2040 |     const composer = page.locator("textarea").first();
  2041 |     await composer.fill(fixture.question);
  2042 |     await composer.locator("xpath=..").getByRole("button").click();
  2043 | 
  2044 |     const answer = page.getByText(fixture.answer, { exact: true });
> 2045 |     await expect(answer).toHaveCount(1);
       |                          ^ Error: expect(locator).toHaveCount(expected) failed
  2046 |     await expect(answer).toBeVisible();
  2047 |     await expect(page.getByText("INCOMPLETE:", { exact: false })).toBeVisible();
  2048 |     await expect(
  2049 |       page.getByText("provider failure", { exact: false }).last(),
  2050 |     ).toBeVisible();
  2051 |     await expect(
  2052 |       page.getByText("stopped: provider timeout", { exact: false }).last(),
  2053 |     ).toBeVisible();
  2054 |     await expect(
  2055 |       page.getByText("The provider disconnected after visible response text.", {
  2056 |         exact: true,
  2057 |       }),
  2058 |     ).toBeVisible();
  2059 | 
  2060 |     await page.reload();
  2061 |     await page
  2062 |       .getByRole("button", { name: fixture.question, exact: true })
  2063 |       .click();
  2064 | 
  2065 |     await expect(page.getByText(fixture.answer, { exact: true })).toHaveCount(
  2066 |       1,
  2067 |     );
  2068 |     await expect(page.getByText(fixture.answer, { exact: true })).toBeVisible();
  2069 |     await expect(page.getByText("INCOMPLETE:", { exact: false })).toBeVisible();
  2070 |     await expect(
  2071 |       page.getByText("provider failure", { exact: false }).last(),
  2072 |     ).toBeVisible();
  2073 |     await expect(
  2074 |       page.getByText("stopped: provider timeout", { exact: false }).last(),
  2075 |     ).toBeVisible();
  2076 |     await expect(
  2077 |       page.getByText("The provider disconnected after visible response text.", {
  2078 |         exact: true,
  2079 |       }),
  2080 |     ).toBeVisible();
  2081 |   });
  2082 | 
  2083 |   test("resumes a failed analysis and keeps the execution incomplete", async ({
  2084 |     page,
  2085 |   }) => {
  2086 |     const { fixture, execution } = installResumedAnalysisFailureFixture();
  2087 |     await installApiFixtures(page, {
  2088 |       arabicAi: fixture,
  2089 |       resumeFailure: { fixture, execution },
  2090 |     });
  2091 |     await programmaticSignIn(page);
  2092 | 
  2093 |     await page.evaluate(
  2094 |       ({ sessionId, executionId, projectId, resumeToken, message }) => {
  2095 |         localStorage.setItem(
  2096 |           `eos_ai_execution_current_${projectId}`,
  2097 |           sessionId,
  2098 |         );
  2099 |         localStorage.setItem(
  2100 |           `eos_ai_execution_${projectId}_${sessionId}`,
  2101 |           JSON.stringify({
  2102 |             id: executionId,
  2103 |             projectId,
  2104 |             sessionId,
  2105 |             resumeToken,
  2106 |             message,
  2107 |           }),
  2108 |         );
  2109 |       },
  2110 |       {
  2111 |         sessionId: fixture.sessionId,
  2112 |         executionId: fixture.executionId,
  2113 |         projectId: "e2e-project",
  2114 |         resumeToken: "e2e-resumed-analysis-failure-token-opaque",
  2115 |         message: fixture.question,
  2116 |       },
  2117 |     );
  2118 |     await page.goto(`${DASHBOARD_PATH}ai`);
  2119 | 
  2120 |     await expect(
  2121 |       page.getByText("A saved AI execution is ready to resume"),
  2122 |     ).toBeVisible();
  2123 |     const resumeRequest = page.waitForRequest(
  2124 |       (request) =>
  2125 |         request.url().includes("/api/ai/chat/stream") &&
  2126 |         request.method() === "POST",
  2127 |     );
  2128 |     await page.getByRole("button", { name: "Resume", exact: true }).click();
  2129 |     const requestBody = JSON.parse(
  2130 |       (await resumeRequest).postData() ?? "{}",
  2131 |     ) as Record<string, unknown>;
  2132 |     expect(requestBody).toEqual(
  2133 |       expect.objectContaining({
  2134 |         projectId: "e2e-project",
  2135 |         sessionId: fixture.sessionId,
  2136 |         executionId: fixture.executionId,
  2137 |         resumeToken: "e2e-resumed-analysis-failure-token-opaque",
  2138 |         message: fixture.question,
  2139 |       }),
  2140 |     );
  2141 | 
  2142 |     await expect(
  2143 |       page.getByText("Failed to send message", { exact: true }),
  2144 |     ).toBeVisible();
  2145 |     await expect(
```