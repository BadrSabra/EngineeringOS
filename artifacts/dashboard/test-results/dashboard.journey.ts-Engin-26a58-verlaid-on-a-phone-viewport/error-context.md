# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: dashboard.journey.ts >> EngineeringOS dashboard browser journey >> keeps the failed AI session drawer overlaid on a phone viewport
- Location: e2e/dashboard.journey.ts:1938:3

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
  1909 |     ).toBeVisible();
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
> 1960 |     ).toBeVisible();
       |       ^ Error: expect(locator).toBeVisible() failed
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
  2045 |     await expect(answer).toHaveCount(1);
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
```