# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: dashboard.journey.ts >> EngineeringOS dashboard browser journey >> keeps the AI session drawer overlaid on a phone viewport with accepted evidence
- Location: e2e/dashboard.journey.ts:1789:3

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
> 1811 |     ).toBeVisible();
       |       ^ Error: expect(locator).toBeVisible() failed
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
```