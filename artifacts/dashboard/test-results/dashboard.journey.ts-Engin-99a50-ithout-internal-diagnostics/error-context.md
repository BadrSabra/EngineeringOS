# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: dashboard.journey.ts >> EngineeringOS dashboard browser journey >> renders an Arabic source-backed AI answer without internal diagnostics
- Location: e2e/dashboard.journey.ts:1736:3

# Error details

```
Error: expect(received).toContain(expected) // indexOf

Expected substring: "The required analysis did not complete."
Received string:    "EngineeringOS
CORE OPS
Dashboard
Projects
Tasks
Rules Engine
Workflows
Event Stream
Metrics
Knowledge Graph
AI Assistant
Flight Deck
Mission Control
ED
EngineeringOS Dashboard Smoke
Connected
v1.0.4-stable
SESSIONS
Smoke Project
ماذا يحدث عند انتهاء مهلة provider timeout داخل execution-tools.ts؟
OPENROUTER API KEY
Priority·
Loading…·
Save
GEMINI API KEY
Free · Priority·
Loading…·
Save
DEEPSEEK API KEY
Optional·
Loading…·
Save
GROQ API KEY·
Loading…·
Save
EngineeringOS AI
Llama 3.3 · Groq
ماذا يحدث عند انتهاء مهلة provider timeout داخل execution-tools.ts؟·
عند انتهاء مهلة مزود الذكاء الاصطناعي، يعيد المسار تقريرًا جزئيًا من الأدلة التي جُمعت بدل إصدار Finding غير مثبت.·
6) Final Judgment·
NOT PROVEN·
Behavior evidence · 1 excerpt
Accepted: source span verified.
return partialFromCollectedEvidence(\"provider timeout\");
src/execution-tools.ts:42
View file
Behavior answer
confidence 100%·
عند انتهاء مهلة مزود الذكاء الاصطناعي، يعيد المسار تقريرًا جزئيًا من الأدلة التي جُمعت بدل إصدار Finding غير مثبت.·
src/execution-tools.ts
Answered fields: timeout behavior
Behavior evidence · 1 excerpt
Accepted: source span verified.
return partialFromCollectedEvidence(\"provider timeout\");
src/execution-tools.ts:42
View file
Agent activity
· 1 events
✓
Reading source · src/execution-tools.ts
src/execution-tools.ts
Forensic evidence
NOT PROVEN"
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
                - paragraph [ref=f2e118]: Loading…
                - generic [ref=f2e119]:
                  - textbox "sk-or-…" [ref=f2e120]
                  - button "Save" [disabled]
              - generic [ref=f2e121]:
                - generic [ref=f2e122]:
                  - generic [ref=f2e127]: Gemini API Key
                  - generic [ref=f2e128]: Free · Priority
                - paragraph [ref=f2e129]: Loading…
                - generic [ref=f2e130]:
                  - textbox "AIza…" [ref=f2e131]
                  - button "Save" [ref=f2e132]
              - generic [ref=f2e133]:
                - generic [ref=f2e134]:
                  - generic [ref=f2e139]: DeepSeek API Key
                  - generic [ref=f2e140]: Optional
                - paragraph [ref=f2e141]: Loading…
                - generic [ref=f2e142]:
                  - textbox "sk-…" [ref=f2e143]
                  - button "Save" [disabled]
              - generic [ref=f2e144]:
                - generic [ref=f2e145]: Groq API Key
                - paragraph [ref=f2e151]: Loading…
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
                  - generic "Agent activity · 1 events" [active] [ref=f2e254] [cursor=pointer]:
                    - generic [ref=f2e257]: Agent activity
                    - generic [ref=f2e258]: · 1 events
                  - generic [ref=f2e262]:
                    - generic [ref=f2e263]: ✓
                    - generic [ref=f2e264]: Reading source · src/execution-tools.ts
                    - code [ref=f2e265]: src/execution-tools.ts
                - button "Forensic evidence NOT PROVEN" [ref=f2e267]:
                  - generic [ref=f2e270]: Forensic evidence
                  - generic [ref=f2e271]: NOT PROVEN
            - generic [ref=f2e275]:
              - textbox "Ask about your codebase, tasks, or metrics… (Enter to send)" [ref=f2e276]
              - button [disabled]
  - region "Notifications (F8)":
    - list
```

# Test source

```ts
  1686 |           url.searchParams.get("page") === "2"
  1687 |         );
  1688 |       }),
  1689 |       page.getByRole("button", { name: "Older" }).click(),
  1690 |     ]);
  1691 |     await expect(page.getByText("Page 2.", { exact: false })).toBeVisible();
  1692 |     await expect(
  1693 |       page.getByText("Older event 50", { exact: true }),
  1694 |     ).toBeVisible();
  1695 |     await expect(
  1696 |       page.getByText("Filtered release event 0", { exact: true }),
  1697 |     ).not.toBeVisible();
  1698 |     expect(new URL(eventRequests.at(-1)!).searchParams.get("page")).toBe("2");
  1699 |     await page.getByRole("button", { name: "Newer" }).click();
  1700 |     await expect(page.getByText("Page 1.", { exact: false })).toBeVisible();
  1701 |     await expect(
  1702 |       page.getByText("Filtered release event 0", { exact: true }),
  1703 |     ).toBeVisible();
  1704 | 
  1705 |     await page.getByPlaceholder("Search logs...").fill("Filtered release");
  1706 |     await page.getByRole("button", { name: "Toggle event filters" }).click();
  1707 |     await page.locator("select").nth(1).selectOption("success");
  1708 |     await expect(
  1709 |       page.getByText("Filtered release event 0", { exact: true }),
  1710 |     ).toBeVisible();
  1711 |     await expect(
  1712 |       page.getByText("Older event 1", { exact: true }),
  1713 |     ).not.toBeVisible();
  1714 |     await expect(page).toHaveURL(/search=Filtered\+release/);
  1715 |     await expect(page).toHaveURL(/severity=success/);
  1716 | 
  1717 |     await page.reload();
  1718 |     await expect(
  1719 |       page.getByText("Filtered release event 0", { exact: true }),
  1720 |     ).toBeVisible();
  1721 |     await expect(
  1722 |       page.getByText("Older event 1", { exact: true }),
  1723 |     ).not.toBeVisible();
  1724 |     await expect(page.getByPlaceholder("Search logs...")).toHaveValue(
  1725 |       "Filtered release",
  1726 |     );
  1727 |     await page.getByRole("button", { name: "Toggle event filters" }).click();
  1728 |     await expect(page.locator("select").nth(1)).toHaveValue("success");
  1729 |     const filteredRequest = new URL(eventRequests.at(-1)!);
  1730 |     expect(filteredRequest.searchParams.get("limit")).toBe("50");
  1731 |     expect(filteredRequest.searchParams.get("page")).toBe("1");
  1732 |     expect(filteredRequest.searchParams.get("search")).toBe("Filtered release");
  1733 |     expect(filteredRequest.searchParams.get("severity")).toBe("success");
  1734 |   });
  1735 | 
  1736 |   test("renders an Arabic source-backed AI answer without internal diagnostics", async ({
  1737 |     page,
  1738 |   }) => {
  1739 |     const fixture = await installArabicAiFixture(page);
  1740 |     await installApiFixtures(page, { arabicAi: fixture });
  1741 |     await programmaticSignIn(page);
  1742 |     await page.goto(`${DASHBOARD_PATH}ai`);
  1743 | 
  1744 |     const composer = page.locator("textarea").first();
  1745 |     await expect(composer).toBeVisible();
  1746 |     await composer.fill(fixture.question);
  1747 |     const sendButton = composer.locator("xpath=..").getByRole("button");
  1748 |     await expect(sendButton).toBeEnabled();
  1749 |     const streamResponsePromise = page.waitForResponse((response) =>
  1750 |       response.url().includes("/api/ai/chat/stream"),
  1751 |     );
  1752 |     await sendButton.click();
  1753 |     const streamResponse = await streamResponsePromise;
  1754 |     expect(streamResponse.status()).toBe(200);
  1755 | 
  1756 |     await expect(
  1757 |       page.getByText(fixture.question, { exact: true }).last(),
  1758 |     ).toBeVisible();
  1759 |     await expect(
  1760 |       page.getByText(fixture.answer, { exact: true }).last(),
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
> 1786 |     expect(visibleText).toContain("The required analysis did not complete.");
       |                         ^ Error: expect(received).toContain(expected) // indexOf
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
  1861 |     await composer.fill(fixture.question);
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
```