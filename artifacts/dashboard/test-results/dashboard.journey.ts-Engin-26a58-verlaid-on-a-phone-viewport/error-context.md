# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: dashboard.journey.ts >> EngineeringOS dashboard browser journey >> keeps the failed AI session drawer overlaid on a phone viewport
- Location: e2e/dashboard.journey.ts:1959:3

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
- banner:
  - button "Open navigation"
  - textbox "Search projects, tasks, rules... (Press '/')"
  - button
- main:
  - button "Open sessions"
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
  1930 |     ).toBeVisible();
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
> 1981 |     ).toBeVisible();
       |       ^ Error: expect(locator).toBeVisible() failed
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
```