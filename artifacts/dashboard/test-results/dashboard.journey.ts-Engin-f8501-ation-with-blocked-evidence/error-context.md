# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: dashboard.journey.ts >> EngineeringOS dashboard browser journey >> keeps safe citation state across browser back and forward navigation with blocked evidence
- Location: e2e/dashboard.journey.ts:1615:3

# Error details

```
ReferenceError: fixture is not defined
```

# Page snapshot

```yaml
- generic [active]:
  - generic:
    - region "Notifications (F8)":
      - list
```

# Test source

```ts
  1535 |     ).toBeVisible();
  1536 |     await expect(
  1537 |       page.getByText("Agent activity", { exact: false }),
  1538 |     ).toBeVisible();
  1539 |     await page.locator("summary").filter({ hasText: "Agent activity" }).click();
  1540 |     await expect(
  1541 |       page.getByText("Reading source", { exact: false }),
  1542 |     ).toBeVisible();
  1543 |     await expect(
  1544 |       page.getByText(fixture.source, { exact: true }).last(),
  1545 |     ).toBeVisible();
  1546 |     await expect(
  1547 |       page.getByText(/Behavior evidence · 1 excerpt/i).last(),
  1548 |     ).toBeVisible();
  1549 |     await expect(
  1550 |       page
  1551 |         .getByText('return partialFromCollectedEvidence("provider timeout");', {
  1552 |           exact: true,
  1553 |         })
  1554 |         .last(),
  1555 |     ).toBeVisible();
  1556 | 
  1557 |     const visibleText = await page.locator("body").innerText();
  1558 |     expect(visibleText).not.toContain("COMPLETED");
  1559 |     expect(visibleText).not.toContain("Persisted execution proof");
  1560 |     expect(visibleText).toContain("The required analysis did not complete.");
  1561 |   });
  1562 | 
  1563 |   test("keeps the AI session drawer overlaid on a phone viewport with accepted evidence", async ({
  1564 |     page,
  1565 |   }) => {
  1566 |     await page.setViewportSize({ width: 390, height: 844 });
  1567 |     const fixture = await installArabicAiFixture(page);
  1568 |     await installApiFixtures(page, { arabicAi: fixture });
  1569 |     await programmaticSignIn(page);
  1570 |     await page.goto(`${DASHBOARD_PATH}ai`);
  1571 | 
  1572 |     const composer = page.locator("textarea").first();
  1573 |     await composer.fill(fixture.question);
  1574 |     await composer.locator("xpath=..").getByRole("button").click();
  1575 | 
  1576 |     await expect(
  1577 |       page.getByText(fixture.answer, { exact: true }).last(),
  1578 |     ).toBeVisible();
  1579 |     await expect(
  1580 |       page
  1581 |         .getByText("required tool did not complete — BLOCKED/INCOMPLETE", {
  1582 |           exact: false,
  1583 |         })
  1584 |         .last(),
  1585 |     ).toBeVisible();
  1586 |     await page
  1587 |       .locator("summary")
  1588 |       .filter({ hasText: "Agent activity" })
  1589 |       .last()
  1590 |       .click();
  1591 |     await expect(page.locator("body")).toContainText("Reading source");
  1592 |     await expect(page.locator("body")).toContainText(
  1593 |       "src/missing-release-fixture.ts",
  1594 |     );
  1595 |     await expect(page.locator("body")).toContainText("Tool failed");
  1596 |     await expect(page.locator("body")).toContainText("TOOL_EXECUTION_FAILED");
  1597 |     await page
  1598 |       .locator("summary")
  1599 |       .filter({ hasText: "Persisted execution proof" })
  1600 |       .last()
  1601 |       .click();
  1602 |     await expect(
  1603 |       page
  1604 |         .getByText("required tool failed — operation blocked", { exact: true })
  1605 |         .last(),
  1606 |     ).toBeVisible();
  1607 |     await expectNoHorizontalOverflow(page);
  1608 | 
  1609 |     const visibleText = await page.locator("body").innerText();
  1610 |     expect(visibleText).not.toMatch(
  1611 |       /rawPrompt|systemPrompt|provider diagnostics|source-window|recovery prompt|\/home\/runner/i,
  1612 |     );
  1613 |   });
  1614 | 
  1615 |   test("keeps safe citation state across browser back and forward navigation with blocked evidence", async ({
  1616 |     page,
  1617 |   }) => {
  1618 |     const accepted = await installArabicAiFixture(page, {
  1619 |       sessionId: "e2e-history-accepted-session",
  1620 |       question: "ما هو سلوك مهلة provider عند الرجوع عبر سجل المتصفح؟",
  1621 |     });
  1622 |     const blocked = await installArabicAiFixture(page, {
  1623 |       blocked: true,
  1624 |       sessionId: "e2e-history-blocked-session",
  1625 |       question: "ما هو الدليل المحجوب عند الرجوع عبر سجل المتصفح؟",
  1626 |     });
  1627 |     await installApiFixtures(page, {
  1628 |       arabicAi: accepted,
  1629 |       alternateAi: blocked,
  1630 |     });
  1631 |     await programmaticSignIn(page);
  1632 |     await page.goto(`${DASHBOARD_PATH}ai`);
  1633 | 
  1634 |     const composer = page.locator("textarea").first();
> 1635 |     await composer.fill(fixture.question);
       |                         ^ ReferenceError: fixture is not defined
  1636 |     await composer.locator("xpath=..").getByRole("button").click();
  1637 | 
  1638 |     await expect(
  1639 |       page.getByText(fixture.answer, { exact: true }).last(),
  1640 |     ).toBeVisible();
  1641 |     await expect(
  1642 |       page
  1643 |         .getByText("required tool did not complete — BLOCKED/INCOMPLETE", {
  1644 |           exact: false,
  1645 |         })
  1646 |         .last(),
  1647 |     ).toBeVisible();
  1648 |     await page
  1649 |       .locator("summary")
  1650 |       .filter({ hasText: "Agent activity" })
  1651 |       .last()
  1652 |       .click();
  1653 |     await expect(page.locator("body")).toContainText("Reading source");
  1654 |     await expect(page.locator("body")).toContainText(
  1655 |       "src/missing-release-fixture.ts",
  1656 |     );
  1657 |     await expect(page.locator("body")).toContainText("Tool failed");
  1658 |     await expect(page.locator("body")).toContainText("TOOL_EXECUTION_FAILED");
  1659 |     await page
  1660 |       .locator("summary")
  1661 |       .filter({ hasText: "Persisted execution proof" })
  1662 |       .last()
  1663 |       .click();
  1664 |     await expect(
  1665 |       page
  1666 |         .getByText("required tool failed — operation blocked", { exact: true })
  1667 |         .last(),
  1668 |     ).toBeVisible();
  1669 | 
  1670 |     const visibleText = await page.locator("body").innerText();
  1671 |     expect(visibleText).not.toMatch(
  1672 |       /rawPrompt|systemPrompt|provider diagnostics|source-window|recovery prompt|\/home\/runner/i,
  1673 |     );
  1674 |   });
  1675 | 
  1676 |   test("keeps safe citation state when switching projects", async ({
  1677 |     page,
  1678 |   }) => {
  1679 |     const accepted = await installArabicAiFixture(page, {
  1680 |       sessionId: "e2e-history-accepted-session",
  1681 |       question: "ما هو سلوك مهلة provider عند الرجوع عبر سجل المتصفح؟",
  1682 |     });
  1683 |     const blocked = await installArabicAiFixture(page, {
  1684 |       blocked: true,
  1685 |       sessionId: "e2e-history-blocked-session",
  1686 |       question: "ما هو الدليل المحجوب عند الرجوع عبر سجل المتصفح؟",
  1687 |     });
  1688 |     await installApiFixtures(page, {
  1689 |       arabicAi: accepted,
  1690 |       alternateAi: blocked,
  1691 |       projects: [
  1692 |         {
  1693 |           id: "e2e-project-one",
  1694 |           name: "Citation Project One",
  1695 |           language: "TypeScript",
  1696 |           framework: "React",
  1697 |           status: "active",
  1698 |           rootPath: "/controlled/project-one",
  1699 |           qualityScore: 92,
  1700 |         },
  1701 |         {
  1702 |           id: "e2e-project-two",
  1703 |           name: "Citation Project Two",
  1704 |           language: "TypeScript",
  1705 |           framework: "React",
  1706 |           status: "active",
  1707 |           rootPath: "/controlled/project-two",
  1708 |           qualityScore: 88,
  1709 |         },
  1710 |       ],
  1711 |     });
  1712 |     await programmaticSignIn(page);
  1713 |     await page.goto(`${DASHBOARD_PATH}ai`);
  1714 | 
  1715 |     await page
  1716 |       .getByRole("button", { name: accepted.question, exact: true })
  1717 |       .click();
  1718 |     await expect(
  1719 |       page.getByText(accepted.answer, { exact: true }).last(),
  1720 |     ).toBeVisible();
  1721 |     await expect(
  1722 |       page.getByText(`${accepted.source}:42`, { exact: false }).last(),
  1723 |     ).toBeVisible();
  1724 |     await expect(
  1725 |       page.getByText("Accepted: source span verified.", { exact: true }).last(),
  1726 |     ).toBeVisible();
  1727 | 
  1728 |     await page.getByRole("combobox").selectOption("e2e-project-two");
  1729 |     await expect(
  1730 |       page.getByRole("button", { name: blocked.question, exact: true }),
  1731 |     ).toBeVisible();
  1732 |     await expect(page.getByText(accepted.answer, { exact: true })).toHaveCount(
  1733 |       0,
  1734 |     );
  1735 |     await page
```