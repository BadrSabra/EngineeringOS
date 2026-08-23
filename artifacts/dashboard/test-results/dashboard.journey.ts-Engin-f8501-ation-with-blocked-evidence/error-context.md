# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: dashboard.journey.ts >> EngineeringOS dashboard browser journey >> keeps safe citation state across browser back and forward navigation with blocked evidence
- Location: e2e/dashboard.journey.ts:1631:3

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
  1551 |     ).toBeVisible();
  1552 |     await expect(
  1553 |       page.getByText("Agent activity", { exact: false }),
  1554 |     ).toBeVisible();
  1555 |     await page.locator("summary").filter({ hasText: "Agent activity" }).click();
  1556 |     await expect(
  1557 |       page.getByText("Reading source", { exact: false }),
  1558 |     ).toBeVisible();
  1559 |     await expect(
  1560 |       page.getByText(fixture.source, { exact: true }).last(),
  1561 |     ).toBeVisible();
  1562 |     await expect(
  1563 |       page.getByText(/Behavior evidence · 1 excerpt/i).last(),
  1564 |     ).toBeVisible();
  1565 |     await expect(
  1566 |       page
  1567 |         .getByText('return partialFromCollectedEvidence("provider timeout");', {
  1568 |           exact: true,
  1569 |         })
  1570 |         .last(),
  1571 |     ).toBeVisible();
  1572 | 
  1573 |     const visibleText = await page.locator("body").innerText();
  1574 |     expect(visibleText).not.toContain("COMPLETED");
  1575 |     expect(visibleText).not.toContain("Persisted execution proof");
  1576 |     expect(visibleText).toContain("The required analysis did not complete.");
  1577 |   });
  1578 | 
  1579 |   test("keeps the AI session drawer overlaid on a phone viewport with accepted evidence", async ({
  1580 |     page,
  1581 |   }) => {
  1582 |     await page.setViewportSize({ width: 390, height: 844 });
  1583 |     const fixture = await installArabicAiFixture(page);
  1584 |     await installApiFixtures(page, { arabicAi: fixture });
  1585 |     await programmaticSignIn(page);
  1586 |     await page.goto(`${DASHBOARD_PATH}ai`);
  1587 | 
  1588 |     const composer = page.locator("textarea").first();
  1589 |     await composer.fill(fixture.question);
  1590 |     await composer.locator("xpath=..").getByRole("button").click();
  1591 | 
  1592 |     await expect(
  1593 |       page.getByText(fixture.answer, { exact: true }).last(),
  1594 |     ).toBeVisible();
  1595 |     await expect(
  1596 |       page
  1597 |         .getByText("required tool did not complete — BLOCKED/INCOMPLETE", {
  1598 |           exact: false,
  1599 |         })
  1600 |         .last(),
  1601 |     ).toBeVisible();
  1602 |     await page
  1603 |       .locator("summary")
  1604 |       .filter({ hasText: "Agent activity" })
  1605 |       .last()
  1606 |       .click();
  1607 |     await expect(page.locator("body")).toContainText("Reading source");
  1608 |     await expect(page.locator("body")).toContainText(
  1609 |       "src/missing-release-fixture.ts",
  1610 |     );
  1611 |     await expect(page.locator("body")).toContainText("Tool failed");
  1612 |     await expect(page.locator("body")).toContainText("TOOL_EXECUTION_FAILED");
  1613 |     await page
  1614 |       .locator("summary")
  1615 |       .filter({ hasText: "Persisted execution proof" })
  1616 |       .last()
  1617 |       .click();
  1618 |     await expect(
  1619 |       page
  1620 |         .getByText("required tool failed — operation blocked", { exact: true })
  1621 |         .last(),
  1622 |     ).toBeVisible();
  1623 |     await expectNoHorizontalOverflow(page);
  1624 | 
  1625 |     const visibleText = await page.locator("body").innerText();
  1626 |     expect(visibleText).not.toMatch(
  1627 |       /rawPrompt|systemPrompt|provider diagnostics|source-window|recovery prompt|\/home\/runner/i,
  1628 |     );
  1629 |   });
  1630 | 
  1631 |   test("keeps safe citation state across browser back and forward navigation with blocked evidence", async ({
  1632 |     page,
  1633 |   }) => {
  1634 |     const accepted = await installArabicAiFixture(page, {
  1635 |       sessionId: "e2e-history-accepted-session",
  1636 |       question: "ما هو سلوك مهلة provider عند الرجوع عبر سجل المتصفح؟",
  1637 |     });
  1638 |     const blocked = await installArabicAiFixture(page, {
  1639 |       blocked: true,
  1640 |       sessionId: "e2e-history-blocked-session",
  1641 |       question: "ما هو الدليل المحجوب عند الرجوع عبر سجل المتصفح؟",
  1642 |     });
  1643 |     await installApiFixtures(page, {
  1644 |       arabicAi: accepted,
  1645 |       alternateAi: blocked,
  1646 |     });
  1647 |     await programmaticSignIn(page);
  1648 |     await page.goto(`${DASHBOARD_PATH}ai`);
  1649 | 
  1650 |     const composer = page.locator("textarea").first();
> 1651 |     await composer.fill(fixture.question);
       |                         ^ ReferenceError: fixture is not defined
  1652 |     await composer.locator("xpath=..").getByRole("button").click();
  1653 | 
  1654 |     await expect(
  1655 |       page.getByText(fixture.answer, { exact: true }).last(),
  1656 |     ).toBeVisible();
  1657 |     await expect(
  1658 |       page
  1659 |         .getByText("required tool did not complete — BLOCKED/INCOMPLETE", {
  1660 |           exact: false,
  1661 |         })
  1662 |         .last(),
  1663 |     ).toBeVisible();
  1664 |     await page
  1665 |       .locator("summary")
  1666 |       .filter({ hasText: "Agent activity" })
  1667 |       .last()
  1668 |       .click();
  1669 |     await expect(page.locator("body")).toContainText("Reading source");
  1670 |     await expect(page.locator("body")).toContainText(
  1671 |       "src/missing-release-fixture.ts",
  1672 |     );
  1673 |     await expect(page.locator("body")).toContainText("Tool failed");
  1674 |     await expect(page.locator("body")).toContainText("TOOL_EXECUTION_FAILED");
  1675 |     await page
  1676 |       .locator("summary")
  1677 |       .filter({ hasText: "Persisted execution proof" })
  1678 |       .last()
  1679 |       .click();
  1680 |     await expect(
  1681 |       page
  1682 |         .getByText("required tool failed — operation blocked", { exact: true })
  1683 |         .last(),
  1684 |     ).toBeVisible();
  1685 | 
  1686 |     const visibleText = await page.locator("body").innerText();
  1687 |     expect(visibleText).not.toMatch(
  1688 |       /rawPrompt|systemPrompt|provider diagnostics|source-window|recovery prompt|\/home\/runner/i,
  1689 |     );
  1690 |   });
  1691 | 
  1692 |   test("keeps safe citation state when switching projects", async ({
  1693 |     page,
  1694 |   }) => {
  1695 |     const accepted = await installArabicAiFixture(page, {
  1696 |       sessionId: "e2e-history-accepted-session",
  1697 |       question: "ما هو سلوك مهلة provider عند الرجوع عبر سجل المتصفح؟",
  1698 |     });
  1699 |     const blocked = await installArabicAiFixture(page, {
  1700 |       blocked: true,
  1701 |       sessionId: "e2e-history-blocked-session",
  1702 |       question: "ما هو الدليل المحجوب عند الرجوع عبر سجل المتصفح؟",
  1703 |     });
  1704 |     await installApiFixtures(page, {
  1705 |       arabicAi: accepted,
  1706 |       alternateAi: blocked,
  1707 |       projects: [
  1708 |         {
  1709 |           id: "e2e-project-one",
  1710 |           name: "Citation Project One",
  1711 |           language: "TypeScript",
  1712 |           framework: "React",
  1713 |           status: "active",
  1714 |           rootPath: "/controlled/project-one",
  1715 |           qualityScore: 92,
  1716 |         },
  1717 |         {
  1718 |           id: "e2e-project-two",
  1719 |           name: "Citation Project Two",
  1720 |           language: "TypeScript",
  1721 |           framework: "React",
  1722 |           status: "active",
  1723 |           rootPath: "/controlled/project-two",
  1724 |           qualityScore: 88,
  1725 |         },
  1726 |       ],
  1727 |     });
  1728 |     await programmaticSignIn(page);
  1729 |     await page.goto(`${DASHBOARD_PATH}ai`);
  1730 | 
  1731 |     await page
  1732 |       .getByRole("button", { name: accepted.question, exact: true })
  1733 |       .click();
  1734 |     await expect(
  1735 |       page.getByText(accepted.answer, { exact: true }).last(),
  1736 |     ).toBeVisible();
  1737 |     await expect(
  1738 |       page.getByText(`${accepted.source}:42`, { exact: false }).last(),
  1739 |     ).toBeVisible();
  1740 |     await expect(
  1741 |       page.getByText("Accepted: source span verified.", { exact: true }).last(),
  1742 |     ).toBeVisible();
  1743 | 
  1744 |     await page.getByRole("combobox").selectOption("e2e-project-two");
  1745 |     await expect(
  1746 |       page.getByRole("button", { name: blocked.question, exact: true }),
  1747 |     ).toBeVisible();
  1748 |     await expect(page.getByText(accepted.answer, { exact: true })).toHaveCount(
  1749 |       0,
  1750 |     );
  1751 |     await page
```