# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: dashboard.journey.ts >> EngineeringOS dashboard browser journey >> keeps only the safe blocked citation reason after chat reload
- Location: e2e/dashboard.journey.ts:1893:3

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
  1814 |           .getByText("Blocked: no matching source text was found.", {
  1815 |             exact: true,
  1816 |           })
  1817 |           .last(),
  1818 |       ).toBeVisible();
  1819 |       await expect(
  1820 |         page.getByText(`${blocked.source}:42`, { exact: false }),
  1821 |       ).toHaveCount(0);
  1822 |       await expect(
  1823 |         page.getByText("Accepted: source span verified.", { exact: true }),
  1824 |       ).toHaveCount(0);
  1825 |     };
  1826 |     const assertNoInternalCitationDetails = async () => {
  1827 |       const visibleText = await page.locator("body").innerText();
  1828 |       expect(visibleText).not.toMatch(
  1829 |         /MISSING_LITERAL_MATCH|rawPrompt|systemPrompt|provider diagnostics|source-window|recovery prompt|\/home\/runner/i,
  1830 |       );
  1831 |     };
  1832 | 
  1833 |     await page
  1834 |       .getByRole("button", { name: accepted.question, exact: true })
  1835 |       .click();
  1836 |     await assertAcceptedCitation();
  1837 | 
  1838 |     await openNavigation(page, "Projects", `${DASHBOARD_PATH}projects`);
  1839 |     await page.goBack();
  1840 |     await expect(page).toHaveURL(
  1841 |       new RegExp(`${DASHBOARD_PATH.replaceAll("/", "\\/")}ai$`),
  1842 |     );
  1843 |     await page
  1844 |       .getByRole("button", { name: accepted.question, exact: true })
  1845 |       .click();
  1846 |     await assertAcceptedCitation();
  1847 |     await assertNoInternalCitationDetails();
  1848 | 
  1849 |     await page.goForward();
  1850 |     await expect(page).toHaveURL(
  1851 |       new RegExp(`${DASHBOARD_PATH.replaceAll("/", "\\/")}projects$`),
  1852 |     );
  1853 |     await page.goBack();
  1854 |     await expect(page).toHaveURL(
  1855 |       new RegExp(`${DASHBOARD_PATH.replaceAll("/", "\\/")}ai$`),
  1856 |     );
  1857 |     await page
  1858 |       .getByRole("button", { name: accepted.question, exact: true })
  1859 |       .click();
  1860 |     await assertAcceptedCitation();
  1861 | 
  1862 |     await page
  1863 |       .getByRole("button", { name: blocked.question, exact: true })
  1864 |       .click();
  1865 |     await assertBlockedCitation();
  1866 | 
  1867 |     await openNavigation(page, "Event Stream", `${DASHBOARD_PATH}events`);
  1868 |     await page.goBack();
  1869 |     await expect(page).toHaveURL(
  1870 |       new RegExp(`${DASHBOARD_PATH.replaceAll("/", "\\/")}ai$`),
  1871 |     );
  1872 |     await page
  1873 |       .getByRole("button", { name: blocked.question, exact: true })
  1874 |       .click();
  1875 |     await assertBlockedCitation();
  1876 |     await assertNoInternalCitationDetails();
  1877 | 
  1878 |     await page.goForward();
  1879 |     await expect(page).toHaveURL(
  1880 |       new RegExp(`${DASHBOARD_PATH.replaceAll("/", "\\/")}events$`),
  1881 |     );
  1882 |     await page.goBack();
  1883 |     await expect(page).toHaveURL(
  1884 |       new RegExp(`${DASHBOARD_PATH.replaceAll("/", "\\/")}ai$`),
  1885 |     );
  1886 |     await page
  1887 |       .getByRole("button", { name: blocked.question, exact: true })
  1888 |       .click();
  1889 |     await assertBlockedCitation();
  1890 |     await assertNoInternalCitationDetails();
  1891 |   });
  1892 | 
  1893 |   test("keeps only the safe blocked citation reason after chat reload", async ({
  1894 |     page,
  1895 |   }) => {
  1896 |     const fixture = await installArabicAiFixture(page);
  1897 |     await installApiFixtures(page, { arabicAi: fixture });
  1898 |     await programmaticSignIn(page);
  1899 |     await page.goto(`${DASHBOARD_PATH}ai`);
  1900 | 
  1901 |     const composer = page.locator("textarea").first();
  1902 |     await composer.fill(fixture.question);
  1903 |     await composer.locator("xpath=..").getByRole("button").click();
  1904 | 
  1905 |     await expect(
  1906 |       page.getByText(fixture.answer, { exact: true }).last(),
  1907 |     ).toBeVisible();
  1908 |     await expect(
  1909 |       page
  1910 |         .getByText("required tool did not complete — BLOCKED/INCOMPLETE", {
  1911 |           exact: false,
  1912 |         })
  1913 |         .last(),
> 1914 |     ).toBeVisible();
       |       ^ Error: expect(locator).toBeVisible() failed
  1915 |     await page
  1916 |       .locator("summary")
  1917 |       .filter({ hasText: "Agent activity" })
  1918 |       .last()
  1919 |       .click();
  1920 |     await expect(page.locator("body")).toContainText("Reading source");
  1921 |     await expect(page.locator("body")).toContainText(
  1922 |       "src/missing-release-fixture.ts",
  1923 |     );
  1924 |     await expect(page.locator("body")).toContainText("Tool failed");
  1925 |     await expect(page.locator("body")).toContainText("TOOL_EXECUTION_FAILED");
  1926 |     await page
  1927 |       .locator("summary")
  1928 |       .filter({ hasText: "Persisted execution proof" })
  1929 |       .last()
  1930 |       .click();
  1931 |     await expect(
  1932 |       page
  1933 |         .getByText("required tool failed — operation blocked", { exact: true })
  1934 |         .last(),
  1935 |     ).toBeVisible();
  1936 | 
  1937 |     const visibleText = await page.locator("body").innerText();
  1938 |     expect(visibleText).not.toContain("COMPLETED");
  1939 |     expect(visibleText).not.toContain("Persisted execution proof");
  1940 |     expect(visibleText).toContain("The required analysis did not complete.");
  1941 |   });
  1942 | 
  1943 |   test("keeps the failed AI session drawer overlaid on a phone viewport", async ({
  1944 |     page,
  1945 |   }) => {
  1946 |     await page.setViewportSize({ width: 390, height: 844 });
  1947 |     const fixture = await installArabicAiFixture(page);
  1948 |     await installApiFixtures(page, { arabicAi: fixture });
  1949 |     await programmaticSignIn(page);
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
```