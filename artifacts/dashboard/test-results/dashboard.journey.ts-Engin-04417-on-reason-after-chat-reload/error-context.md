# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: dashboard.journey.ts >> EngineeringOS dashboard browser journey >> keeps only the safe blocked citation reason after chat reload
- Location: e2e/dashboard.journey.ts:1909:3

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
  1830 |           .getByText("Blocked: no matching source text was found.", {
  1831 |             exact: true,
  1832 |           })
  1833 |           .last(),
  1834 |       ).toBeVisible();
  1835 |       await expect(
  1836 |         page.getByText(`${blocked.source}:42`, { exact: false }),
  1837 |       ).toHaveCount(0);
  1838 |       await expect(
  1839 |         page.getByText("Accepted: source span verified.", { exact: true }),
  1840 |       ).toHaveCount(0);
  1841 |     };
  1842 |     const assertNoInternalCitationDetails = async () => {
  1843 |       const visibleText = await page.locator("body").innerText();
  1844 |       expect(visibleText).not.toMatch(
  1845 |         /MISSING_LITERAL_MATCH|rawPrompt|systemPrompt|provider diagnostics|source-window|recovery prompt|\/home\/runner/i,
  1846 |       );
  1847 |     };
  1848 | 
  1849 |     await page
  1850 |       .getByRole("button", { name: accepted.question, exact: true })
  1851 |       .click();
  1852 |     await assertAcceptedCitation();
  1853 | 
  1854 |     await openNavigation(page, "Projects", `${DASHBOARD_PATH}projects`);
  1855 |     await page.goBack();
  1856 |     await expect(page).toHaveURL(
  1857 |       new RegExp(`${DASHBOARD_PATH.replaceAll("/", "\\/")}ai$`),
  1858 |     );
  1859 |     await page
  1860 |       .getByRole("button", { name: accepted.question, exact: true })
  1861 |       .click();
  1862 |     await assertAcceptedCitation();
  1863 |     await assertNoInternalCitationDetails();
  1864 | 
  1865 |     await page.goForward();
  1866 |     await expect(page).toHaveURL(
  1867 |       new RegExp(`${DASHBOARD_PATH.replaceAll("/", "\\/")}projects$`),
  1868 |     );
  1869 |     await page.goBack();
  1870 |     await expect(page).toHaveURL(
  1871 |       new RegExp(`${DASHBOARD_PATH.replaceAll("/", "\\/")}ai$`),
  1872 |     );
  1873 |     await page
  1874 |       .getByRole("button", { name: accepted.question, exact: true })
  1875 |       .click();
  1876 |     await assertAcceptedCitation();
  1877 | 
  1878 |     await page
  1879 |       .getByRole("button", { name: blocked.question, exact: true })
  1880 |       .click();
  1881 |     await assertBlockedCitation();
  1882 | 
  1883 |     await openNavigation(page, "Event Stream", `${DASHBOARD_PATH}events`);
  1884 |     await page.goBack();
  1885 |     await expect(page).toHaveURL(
  1886 |       new RegExp(`${DASHBOARD_PATH.replaceAll("/", "\\/")}ai$`),
  1887 |     );
  1888 |     await page
  1889 |       .getByRole("button", { name: blocked.question, exact: true })
  1890 |       .click();
  1891 |     await assertBlockedCitation();
  1892 |     await assertNoInternalCitationDetails();
  1893 | 
  1894 |     await page.goForward();
  1895 |     await expect(page).toHaveURL(
  1896 |       new RegExp(`${DASHBOARD_PATH.replaceAll("/", "\\/")}events$`),
  1897 |     );
  1898 |     await page.goBack();
  1899 |     await expect(page).toHaveURL(
  1900 |       new RegExp(`${DASHBOARD_PATH.replaceAll("/", "\\/")}ai$`),
  1901 |     );
  1902 |     await page
  1903 |       .getByRole("button", { name: blocked.question, exact: true })
  1904 |       .click();
  1905 |     await assertBlockedCitation();
  1906 |     await assertNoInternalCitationDetails();
  1907 |   });
  1908 | 
  1909 |   test("keeps only the safe blocked citation reason after chat reload", async ({
  1910 |     page,
  1911 |   }) => {
  1912 |     const fixture = await installArabicAiFixture(page);
  1913 |     await installApiFixtures(page, { arabicAi: fixture });
  1914 |     await programmaticSignIn(page);
  1915 |     await page.goto(`${DASHBOARD_PATH}ai`);
  1916 | 
  1917 |     const composer = page.locator("textarea").first();
  1918 |     await composer.fill(fixture.question);
  1919 |     await composer.locator("xpath=..").getByRole("button").click();
  1920 | 
  1921 |     await expect(
  1922 |       page.getByText(fixture.answer, { exact: true }).last(),
  1923 |     ).toBeVisible();
  1924 |     await expect(
  1925 |       page
  1926 |         .getByText("required tool did not complete — BLOCKED/INCOMPLETE", {
  1927 |           exact: false,
  1928 |         })
  1929 |         .last(),
> 1930 |     ).toBeVisible();
       |       ^ Error: expect(locator).toBeVisible() failed
  1931 |     await page
  1932 |       .locator("summary")
  1933 |       .filter({ hasText: "Agent activity" })
  1934 |       .last()
  1935 |       .click();
  1936 |     await expect(page.locator("body")).toContainText("Reading source");
  1937 |     await expect(page.locator("body")).toContainText(
  1938 |       "src/missing-release-fixture.ts",
  1939 |     );
  1940 |     await expect(page.locator("body")).toContainText("Tool failed");
  1941 |     await expect(page.locator("body")).toContainText("TOOL_EXECUTION_FAILED");
  1942 |     await page
  1943 |       .locator("summary")
  1944 |       .filter({ hasText: "Persisted execution proof" })
  1945 |       .last()
  1946 |       .click();
  1947 |     await expect(
  1948 |       page
  1949 |         .getByText("required tool failed — operation blocked", { exact: true })
  1950 |         .last(),
  1951 |     ).toBeVisible();
  1952 | 
  1953 |     const visibleText = await page.locator("body").innerText();
  1954 |     expect(visibleText).not.toContain("COMPLETED");
  1955 |     expect(visibleText).not.toContain("Persisted execution proof");
  1956 |     expect(visibleText).toContain("The required analysis did not complete.");
  1957 |   });
  1958 | 
  1959 |   test("keeps the failed AI session drawer overlaid on a phone viewport", async ({
  1960 |     page,
  1961 |   }) => {
  1962 |     await page.setViewportSize({ width: 390, height: 844 });
  1963 |     const fixture = await installArabicAiFixture(page);
  1964 |     await installApiFixtures(page, { arabicAi: fixture });
  1965 |     await programmaticSignIn(page);
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
```