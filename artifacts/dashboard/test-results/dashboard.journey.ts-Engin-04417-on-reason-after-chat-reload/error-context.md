# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: dashboard.journey.ts >> EngineeringOS dashboard browser journey >> keeps only the safe blocked citation reason after chat reload
- Location: e2e/dashboard.journey.ts:1888:3

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
  1809 |           .getByText("Blocked: no matching source text was found.", {
  1810 |             exact: true,
  1811 |           })
  1812 |           .last(),
  1813 |       ).toBeVisible();
  1814 |       await expect(
  1815 |         page.getByText(`${blocked.source}:42`, { exact: false }),
  1816 |       ).toHaveCount(0);
  1817 |       await expect(
  1818 |         page.getByText("Accepted: source span verified.", { exact: true }),
  1819 |       ).toHaveCount(0);
  1820 |     };
  1821 |     const assertNoInternalCitationDetails = async () => {
  1822 |       const visibleText = await page.locator("body").innerText();
  1823 |       expect(visibleText).not.toMatch(
  1824 |         /MISSING_LITERAL_MATCH|rawPrompt|systemPrompt|provider diagnostics|source-window|recovery prompt|\/home\/runner/i,
  1825 |       );
  1826 |     };
  1827 | 
  1828 |     await page
  1829 |       .getByRole("button", { name: accepted.question, exact: true })
  1830 |       .click();
  1831 |     await assertAcceptedCitation();
  1832 | 
  1833 |     await openNavigation(page, "Projects", `${DASHBOARD_PATH}projects`);
  1834 |     await page.goBack();
  1835 |     await expect(page).toHaveURL(
  1836 |       new RegExp(`${DASHBOARD_PATH.replaceAll("/", "\\/")}ai$`),
  1837 |     );
  1838 |     await page
  1839 |       .getByRole("button", { name: accepted.question, exact: true })
  1840 |       .click();
  1841 |     await assertAcceptedCitation();
  1842 |     await assertNoInternalCitationDetails();
  1843 | 
  1844 |     await page.goForward();
  1845 |     await expect(page).toHaveURL(
  1846 |       new RegExp(`${DASHBOARD_PATH.replaceAll("/", "\\/")}projects$`),
  1847 |     );
  1848 |     await page.goBack();
  1849 |     await expect(page).toHaveURL(
  1850 |       new RegExp(`${DASHBOARD_PATH.replaceAll("/", "\\/")}ai$`),
  1851 |     );
  1852 |     await page
  1853 |       .getByRole("button", { name: accepted.question, exact: true })
  1854 |       .click();
  1855 |     await assertAcceptedCitation();
  1856 | 
  1857 |     await page
  1858 |       .getByRole("button", { name: blocked.question, exact: true })
  1859 |       .click();
  1860 |     await assertBlockedCitation();
  1861 | 
  1862 |     await openNavigation(page, "Event Stream", `${DASHBOARD_PATH}events`);
  1863 |     await page.goBack();
  1864 |     await expect(page).toHaveURL(
  1865 |       new RegExp(`${DASHBOARD_PATH.replaceAll("/", "\\/")}ai$`),
  1866 |     );
  1867 |     await page
  1868 |       .getByRole("button", { name: blocked.question, exact: true })
  1869 |       .click();
  1870 |     await assertBlockedCitation();
  1871 |     await assertNoInternalCitationDetails();
  1872 | 
  1873 |     await page.goForward();
  1874 |     await expect(page).toHaveURL(
  1875 |       new RegExp(`${DASHBOARD_PATH.replaceAll("/", "\\/")}events$`),
  1876 |     );
  1877 |     await page.goBack();
  1878 |     await expect(page).toHaveURL(
  1879 |       new RegExp(`${DASHBOARD_PATH.replaceAll("/", "\\/")}ai$`),
  1880 |     );
  1881 |     await page
  1882 |       .getByRole("button", { name: blocked.question, exact: true })
  1883 |       .click();
  1884 |     await assertBlockedCitation();
  1885 |     await assertNoInternalCitationDetails();
  1886 |   });
  1887 | 
  1888 |   test("keeps only the safe blocked citation reason after chat reload", async ({
  1889 |     page,
  1890 |   }) => {
  1891 |     const fixture = await installArabicAiFixture(page);
  1892 |     await installApiFixtures(page, { arabicAi: fixture });
  1893 |     await programmaticSignIn(page);
  1894 |     await page.goto(`${DASHBOARD_PATH}ai`);
  1895 | 
  1896 |     const composer = page.locator("textarea").first();
  1897 |     await composer.fill(fixture.question);
  1898 |     await composer.locator("xpath=..").getByRole("button").click();
  1899 | 
  1900 |     await expect(
  1901 |       page.getByText(fixture.answer, { exact: true }).last(),
  1902 |     ).toBeVisible();
  1903 |     await expect(
  1904 |       page
  1905 |         .getByText("required tool did not complete — BLOCKED/INCOMPLETE", {
  1906 |           exact: false,
  1907 |         })
  1908 |         .last(),
> 1909 |     ).toBeVisible();
       |       ^ Error: expect(locator).toBeVisible() failed
  1910 |     await page
  1911 |       .locator("summary")
  1912 |       .filter({ hasText: "Agent activity" })
  1913 |       .last()
  1914 |       .click();
  1915 |     await expect(page.locator("body")).toContainText("Reading source");
  1916 |     await expect(page.locator("body")).toContainText(
  1917 |       "src/missing-release-fixture.ts",
  1918 |     );
  1919 |     await expect(page.locator("body")).toContainText("Tool failed");
  1920 |     await expect(page.locator("body")).toContainText("TOOL_EXECUTION_FAILED");
  1921 |     await page
  1922 |       .locator("summary")
  1923 |       .filter({ hasText: "Persisted execution proof" })
  1924 |       .last()
  1925 |       .click();
  1926 |     await expect(
  1927 |       page
  1928 |         .getByText("required tool failed — operation blocked", { exact: true })
  1929 |         .last(),
  1930 |     ).toBeVisible();
  1931 | 
  1932 |     const visibleText = await page.locator("body").innerText();
  1933 |     expect(visibleText).not.toContain("COMPLETED");
  1934 |     expect(visibleText).not.toContain("Persisted execution proof");
  1935 |     expect(visibleText).toContain("The required analysis did not complete.");
  1936 |   });
  1937 | 
  1938 |   test("keeps the failed AI session drawer overlaid on a phone viewport", async ({
  1939 |     page,
  1940 |   }) => {
  1941 |     await page.setViewportSize({ width: 390, height: 844 });
  1942 |     const fixture = await installArabicAiFixture(page);
  1943 |     await installApiFixtures(page, { arabicAi: fixture });
  1944 |     await programmaticSignIn(page);
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
```