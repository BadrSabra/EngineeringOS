# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: dashboard.journey.ts >> EngineeringOS dashboard browser journey >> keeps the failed AI session drawer overlaid on a phone viewport
- Location: e2e/dashboard.journey.ts:1943:3

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
  1914 |     ).toBeVisible();
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
> 1965 |     ).toBeVisible();
       |       ^ Error: expect(locator).toBeVisible() failed
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
```