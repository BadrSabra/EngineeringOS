# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: dashboard.journey.ts >> EngineeringOS dashboard browser journey >> keeps safe citation state across browser back and forward navigation with blocked evidence
- Location: e2e/dashboard.journey.ts:1841:3

# Error details

```
ReferenceError: fixture is not defined
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
            - combobox [ref=f2e101]
            - generic [ref=f2e106]:
              - generic [ref=f2e107]:
                - generic [ref=f2e108]:
                  - generic [ref=f2e113]: OpenRouter API Key
                  - generic [ref=f2e114]: Priority
                - paragraph [ref=f2e115]: Loading…
                - generic [ref=f2e116]:
                  - textbox "sk-or-…" [ref=f2e117]
                  - button "Save" [disabled]
              - generic [ref=f2e118]:
                - generic [ref=f2e119]:
                  - generic [ref=f2e124]: Gemini API Key
                  - generic [ref=f2e125]: Free · Priority
                - paragraph [ref=f2e126]: Loading…
                - generic [ref=f2e127]:
                  - textbox "AIza…" [ref=f2e128]
                  - button "Save" [ref=f2e129]
              - generic [ref=f2e130]:
                - generic [ref=f2e131]:
                  - generic [ref=f2e136]: DeepSeek API Key
                  - generic [ref=f2e137]: Optional
                - paragraph [ref=f2e138]: Loading…
                - generic [ref=f2e139]:
                  - textbox "sk-…" [ref=f2e140]
                  - button "Save" [disabled]
              - generic [ref=f2e141]:
                - generic [ref=f2e142]: Groq API Key
                - paragraph [ref=f2e148]: Loading…
                - generic [ref=f2e149]:
                  - textbox "gsk_…" [ref=f2e150]
                  - button "Save" [disabled]
          - generic [ref=f2e151]:
            - generic [ref=f2e152]:
              - generic [ref=f2e156]: EngineeringOS AI
              - generic [ref=f2e157]: Llama 3.3 · Groq
            - generic [ref=f2e161]:
              - generic [ref=f2e162]:
                - paragraph [ref=f2e167]: How can I help with your project?
                - paragraph [ref=f2e168]: Loading your projects…
              - generic [ref=f2e169]:
                - button "Analyze Scan" [disabled] [ref=f2e170]
                - button "Code Review" [disabled] [ref=f2e174]
                - button "Task Status" [disabled] [ref=f2e179]
                - button "Workflow Health" [disabled] [ref=f2e182]
                - button "Capability Probe" [disabled] [ref=f2e187]
            - generic [ref=f2e191]:
              - textbox "Loading your projects…" [disabled] [ref=f2e192]
              - button "Loading your projects…" [disabled]
  - region "Notifications (F8)":
    - list
```

# Test source

```ts
  1761 |     ).toBeVisible();
  1762 |     await expect(
  1763 |       page.getByText("Agent activity", { exact: false }),
  1764 |     ).toBeVisible();
  1765 |     await page.locator("summary").filter({ hasText: "Agent activity" }).click();
  1766 |     await expect(
  1767 |       page.getByText("Reading source", { exact: false }),
  1768 |     ).toBeVisible();
  1769 |     await expect(
  1770 |       page.getByText(fixture.source, { exact: true }).last(),
  1771 |     ).toBeVisible();
  1772 |     await expect(
  1773 |       page.getByText(/Behavior evidence · 1 excerpt/i).last(),
  1774 |     ).toBeVisible();
  1775 |     await expect(
  1776 |       page
  1777 |         .getByText('return partialFromCollectedEvidence("provider timeout");', {
  1778 |           exact: true,
  1779 |         })
  1780 |         .last(),
  1781 |     ).toBeVisible();
  1782 | 
  1783 |     const visibleText = await page.locator("body").innerText();
  1784 |     expect(visibleText).not.toContain("COMPLETED");
  1785 |     expect(visibleText).not.toContain("Persisted execution proof");
  1786 |     expect(visibleText).toContain("The required analysis did not complete.");
  1787 |   });
  1788 | 
  1789 |   test("keeps the AI session drawer overlaid on a phone viewport with accepted evidence", async ({
  1790 |     page,
  1791 |   }) => {
  1792 |     await page.setViewportSize({ width: 390, height: 844 });
  1793 |     const fixture = await installArabicAiFixture(page);
  1794 |     await installApiFixtures(page, { arabicAi: fixture });
  1795 |     await programmaticSignIn(page);
  1796 |     await page.goto(`${DASHBOARD_PATH}ai`);
  1797 | 
  1798 |     const composer = page.locator("textarea").first();
  1799 |     await composer.fill(fixture.question);
  1800 |     await composer.locator("xpath=..").getByRole("button").click();
  1801 | 
  1802 |     await expect(
  1803 |       page.getByText(fixture.answer, { exact: true }).last(),
  1804 |     ).toBeVisible();
  1805 |     await expect(
  1806 |       page
  1807 |         .getByText("required tool did not complete — BLOCKED/INCOMPLETE", {
  1808 |           exact: false,
  1809 |         })
  1810 |         .last(),
  1811 |     ).toBeVisible();
  1812 |     await page
  1813 |       .locator("summary")
  1814 |       .filter({ hasText: "Agent activity" })
  1815 |       .last()
  1816 |       .click();
  1817 |     await expect(page.locator("body")).toContainText("Reading source");
  1818 |     await expect(page.locator("body")).toContainText(
  1819 |       "src/missing-release-fixture.ts",
  1820 |     );
  1821 |     await expect(page.locator("body")).toContainText("Tool failed");
  1822 |     await expect(page.locator("body")).toContainText("TOOL_EXECUTION_FAILED");
  1823 |     await page
  1824 |       .locator("summary")
  1825 |       .filter({ hasText: "Persisted execution proof" })
  1826 |       .last()
  1827 |       .click();
  1828 |     await expect(
  1829 |       page
  1830 |         .getByText("required tool failed — operation blocked", { exact: true })
  1831 |         .last(),
  1832 |     ).toBeVisible();
  1833 |     await expectNoHorizontalOverflow(page);
  1834 | 
  1835 |     const visibleText = await page.locator("body").innerText();
  1836 |     expect(visibleText).not.toMatch(
  1837 |       /rawPrompt|systemPrompt|provider diagnostics|source-window|recovery prompt|\/home\/runner/i,
  1838 |     );
  1839 |   });
  1840 | 
  1841 |   test("keeps safe citation state across browser back and forward navigation with blocked evidence", async ({
  1842 |     page,
  1843 |   }) => {
  1844 |     const accepted = await installArabicAiFixture(page, {
  1845 |       sessionId: "e2e-history-accepted-session",
  1846 |       question: "ما هو سلوك مهلة provider عند الرجوع عبر سجل المتصفح؟",
  1847 |     });
  1848 |     const blocked = await installArabicAiFixture(page, {
  1849 |       blocked: true,
  1850 |       sessionId: "e2e-history-blocked-session",
  1851 |       question: "ما هو الدليل المحجوب عند الرجوع عبر سجل المتصفح؟",
  1852 |     });
  1853 |     await installApiFixtures(page, {
  1854 |       arabicAi: accepted,
  1855 |       alternateAi: blocked,
  1856 |     });
  1857 |     await programmaticSignIn(page);
  1858 |     await page.goto(`${DASHBOARD_PATH}ai`);
  1859 | 
  1860 |     const composer = page.locator("textarea").first();
> 1861 |     await composer.fill(fixture.question);
       |                         ^ ReferenceError: fixture is not defined
  1862 |     await composer.locator("xpath=..").getByRole("button").click();
  1863 | 
  1864 |     await expect(
  1865 |       page.getByText(fixture.answer, { exact: true }).last(),
  1866 |     ).toBeVisible();
  1867 |     await expect(
  1868 |       page
  1869 |         .getByText("required tool did not complete — BLOCKED/INCOMPLETE", {
  1870 |           exact: false,
  1871 |         })
  1872 |         .last(),
  1873 |     ).toBeVisible();
  1874 |     await page
  1875 |       .locator("summary")
  1876 |       .filter({ hasText: "Agent activity" })
  1877 |       .last()
  1878 |       .click();
  1879 |     await expect(page.locator("body")).toContainText("Reading source");
  1880 |     await expect(page.locator("body")).toContainText(
  1881 |       "src/missing-release-fixture.ts",
  1882 |     );
  1883 |     await expect(page.locator("body")).toContainText("Tool failed");
  1884 |     await expect(page.locator("body")).toContainText("TOOL_EXECUTION_FAILED");
  1885 |     await page
  1886 |       .locator("summary")
  1887 |       .filter({ hasText: "Persisted execution proof" })
  1888 |       .last()
  1889 |       .click();
  1890 |     await expect(
  1891 |       page
  1892 |         .getByText("required tool failed — operation blocked", { exact: true })
  1893 |         .last(),
  1894 |     ).toBeVisible();
  1895 | 
  1896 |     const visibleText = await page.locator("body").innerText();
  1897 |     expect(visibleText).not.toMatch(
  1898 |       /rawPrompt|systemPrompt|provider diagnostics|source-window|recovery prompt|\/home\/runner/i,
  1899 |     );
  1900 |   });
  1901 | 
  1902 |   test("keeps safe citation state when switching projects", async ({
  1903 |     page,
  1904 |   }) => {
  1905 |     const accepted = await installArabicAiFixture(page, {
  1906 |       sessionId: "e2e-history-accepted-session",
  1907 |       question: "ما هو سلوك مهلة provider عند الرجوع عبر سجل المتصفح؟",
  1908 |     });
  1909 |     const blocked = await installArabicAiFixture(page, {
  1910 |       blocked: true,
  1911 |       sessionId: "e2e-history-blocked-session",
  1912 |       question: "ما هو الدليل المحجوب عند الرجوع عبر سجل المتصفح؟",
  1913 |     });
  1914 |     await installApiFixtures(page, {
  1915 |       arabicAi: accepted,
  1916 |       alternateAi: blocked,
  1917 |       projects: [
  1918 |         {
  1919 |           id: "e2e-project-one",
  1920 |           name: "Citation Project One",
  1921 |           language: "TypeScript",
  1922 |           framework: "React",
  1923 |           status: "active",
  1924 |           rootPath: "/controlled/project-one",
  1925 |           qualityScore: 92,
  1926 |         },
  1927 |         {
  1928 |           id: "e2e-project-two",
  1929 |           name: "Citation Project Two",
  1930 |           language: "TypeScript",
  1931 |           framework: "React",
  1932 |           status: "active",
  1933 |           rootPath: "/controlled/project-two",
  1934 |           qualityScore: 88,
  1935 |         },
  1936 |       ],
  1937 |     });
  1938 |     await programmaticSignIn(page);
  1939 |     await page.goto(`${DASHBOARD_PATH}ai`);
  1940 | 
  1941 |     await page
  1942 |       .getByRole("button", { name: accepted.question, exact: true })
  1943 |       .click();
  1944 |     await expect(
  1945 |       page.getByText(accepted.answer, { exact: true }).last(),
  1946 |     ).toBeVisible();
  1947 |     await expect(
  1948 |       page.getByText(`${accepted.source}:42`, { exact: false }).last(),
  1949 |     ).toBeVisible();
  1950 |     await expect(
  1951 |       page.getByText("Accepted: source span verified.", { exact: true }).last(),
  1952 |     ).toBeVisible();
  1953 | 
  1954 |     await page.getByRole("combobox").selectOption("e2e-project-two");
  1955 |     await expect(
  1956 |       page.getByRole("button", { name: blocked.question, exact: true }),
  1957 |     ).toBeVisible();
  1958 |     await expect(page.getByText(accepted.answer, { exact: true })).toHaveCount(
  1959 |       0,
  1960 |     );
  1961 |     await page
```