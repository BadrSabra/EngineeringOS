# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: dashboard.journey.ts >> EngineeringOS dashboard browser journey >> keeps safe citation state across browser back and forward navigation with blocked evidence
- Location: e2e/dashboard.journey.ts:1610:3

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
  1530 |     ).toBeVisible();
  1531 |     await expect(
  1532 |       page.getByText("Agent activity", { exact: false }),
  1533 |     ).toBeVisible();
  1534 |     await page.locator("summary").filter({ hasText: "Agent activity" }).click();
  1535 |     await expect(
  1536 |       page.getByText("Reading source", { exact: false }),
  1537 |     ).toBeVisible();
  1538 |     await expect(
  1539 |       page.getByText(fixture.source, { exact: true }).last(),
  1540 |     ).toBeVisible();
  1541 |     await expect(
  1542 |       page.getByText(/Behavior evidence · 1 excerpt/i).last(),
  1543 |     ).toBeVisible();
  1544 |     await expect(
  1545 |       page
  1546 |         .getByText('return partialFromCollectedEvidence("provider timeout");', {
  1547 |           exact: true,
  1548 |         })
  1549 |         .last(),
  1550 |     ).toBeVisible();
  1551 | 
  1552 |     const visibleText = await page.locator("body").innerText();
  1553 |     expect(visibleText).not.toContain("COMPLETED");
  1554 |     expect(visibleText).not.toContain("Persisted execution proof");
  1555 |     expect(visibleText).toContain("The required analysis did not complete.");
  1556 |   });
  1557 | 
  1558 |   test("keeps the AI session drawer overlaid on a phone viewport with accepted evidence", async ({
  1559 |     page,
  1560 |   }) => {
  1561 |     await page.setViewportSize({ width: 390, height: 844 });
  1562 |     const fixture = await installArabicAiFixture(page);
  1563 |     await installApiFixtures(page, { arabicAi: fixture });
  1564 |     await programmaticSignIn(page);
  1565 |     await page.goto(`${DASHBOARD_PATH}ai`);
  1566 | 
  1567 |     const composer = page.locator("textarea").first();
  1568 |     await composer.fill(fixture.question);
  1569 |     await composer.locator("xpath=..").getByRole("button").click();
  1570 | 
  1571 |     await expect(
  1572 |       page.getByText(fixture.answer, { exact: true }).last(),
  1573 |     ).toBeVisible();
  1574 |     await expect(
  1575 |       page
  1576 |         .getByText("required tool did not complete — BLOCKED/INCOMPLETE", {
  1577 |           exact: false,
  1578 |         })
  1579 |         .last(),
  1580 |     ).toBeVisible();
  1581 |     await page
  1582 |       .locator("summary")
  1583 |       .filter({ hasText: "Agent activity" })
  1584 |       .last()
  1585 |       .click();
  1586 |     await expect(page.locator("body")).toContainText("Reading source");
  1587 |     await expect(page.locator("body")).toContainText(
  1588 |       "src/missing-release-fixture.ts",
  1589 |     );
  1590 |     await expect(page.locator("body")).toContainText("Tool failed");
  1591 |     await expect(page.locator("body")).toContainText("TOOL_EXECUTION_FAILED");
  1592 |     await page
  1593 |       .locator("summary")
  1594 |       .filter({ hasText: "Persisted execution proof" })
  1595 |       .last()
  1596 |       .click();
  1597 |     await expect(
  1598 |       page
  1599 |         .getByText("required tool failed — operation blocked", { exact: true })
  1600 |         .last(),
  1601 |     ).toBeVisible();
  1602 |     await expectNoHorizontalOverflow(page);
  1603 | 
  1604 |     const visibleText = await page.locator("body").innerText();
  1605 |     expect(visibleText).not.toMatch(
  1606 |       /rawPrompt|systemPrompt|provider diagnostics|source-window|recovery prompt|\/home\/runner/i,
  1607 |     );
  1608 |   });
  1609 | 
  1610 |   test("keeps safe citation state across browser back and forward navigation with blocked evidence", async ({
  1611 |     page,
  1612 |   }) => {
  1613 |     const accepted = await installArabicAiFixture(page, {
  1614 |       sessionId: "e2e-history-accepted-session",
  1615 |       question: "ما هو سلوك مهلة provider عند الرجوع عبر سجل المتصفح؟",
  1616 |     });
  1617 |     const blocked = await installArabicAiFixture(page, {
  1618 |       blocked: true,
  1619 |       sessionId: "e2e-history-blocked-session",
  1620 |       question: "ما هو الدليل المحجوب عند الرجوع عبر سجل المتصفح؟",
  1621 |     });
  1622 |     await installApiFixtures(page, {
  1623 |       arabicAi: accepted,
  1624 |       alternateAi: blocked,
  1625 |     });
  1626 |     await programmaticSignIn(page);
  1627 |     await page.goto(`${DASHBOARD_PATH}ai`);
  1628 | 
  1629 |     const composer = page.locator("textarea").first();
> 1630 |     await composer.fill(fixture.question);
       |                         ^ ReferenceError: fixture is not defined
  1631 |     await composer.locator("xpath=..").getByRole("button").click();
  1632 | 
  1633 |     await expect(
  1634 |       page.getByText(fixture.answer, { exact: true }).last(),
  1635 |     ).toBeVisible();
  1636 |     await expect(
  1637 |       page
  1638 |         .getByText("required tool did not complete — BLOCKED/INCOMPLETE", {
  1639 |           exact: false,
  1640 |         })
  1641 |         .last(),
  1642 |     ).toBeVisible();
  1643 |     await page
  1644 |       .locator("summary")
  1645 |       .filter({ hasText: "Agent activity" })
  1646 |       .last()
  1647 |       .click();
  1648 |     await expect(page.locator("body")).toContainText("Reading source");
  1649 |     await expect(page.locator("body")).toContainText(
  1650 |       "src/missing-release-fixture.ts",
  1651 |     );
  1652 |     await expect(page.locator("body")).toContainText("Tool failed");
  1653 |     await expect(page.locator("body")).toContainText("TOOL_EXECUTION_FAILED");
  1654 |     await page
  1655 |       .locator("summary")
  1656 |       .filter({ hasText: "Persisted execution proof" })
  1657 |       .last()
  1658 |       .click();
  1659 |     await expect(
  1660 |       page
  1661 |         .getByText("required tool failed — operation blocked", { exact: true })
  1662 |         .last(),
  1663 |     ).toBeVisible();
  1664 | 
  1665 |     const visibleText = await page.locator("body").innerText();
  1666 |     expect(visibleText).not.toMatch(
  1667 |       /rawPrompt|systemPrompt|provider diagnostics|source-window|recovery prompt|\/home\/runner/i,
  1668 |     );
  1669 |   });
  1670 | 
  1671 |   test("keeps safe citation state when switching projects", async ({
  1672 |     page,
  1673 |   }) => {
  1674 |     const accepted = await installArabicAiFixture(page, {
  1675 |       sessionId: "e2e-history-accepted-session",
  1676 |       question: "ما هو سلوك مهلة provider عند الرجوع عبر سجل المتصفح؟",
  1677 |     });
  1678 |     const blocked = await installArabicAiFixture(page, {
  1679 |       blocked: true,
  1680 |       sessionId: "e2e-history-blocked-session",
  1681 |       question: "ما هو الدليل المحجوب عند الرجوع عبر سجل المتصفح؟",
  1682 |     });
  1683 |     await installApiFixtures(page, {
  1684 |       arabicAi: accepted,
  1685 |       alternateAi: blocked,
  1686 |       projects: [
  1687 |         {
  1688 |           id: "e2e-project-one",
  1689 |           name: "Citation Project One",
  1690 |           language: "TypeScript",
  1691 |           framework: "React",
  1692 |           status: "active",
  1693 |           rootPath: "/controlled/project-one",
  1694 |           qualityScore: 92,
  1695 |         },
  1696 |         {
  1697 |           id: "e2e-project-two",
  1698 |           name: "Citation Project Two",
  1699 |           language: "TypeScript",
  1700 |           framework: "React",
  1701 |           status: "active",
  1702 |           rootPath: "/controlled/project-two",
  1703 |           qualityScore: 88,
  1704 |         },
  1705 |       ],
  1706 |     });
  1707 |     await programmaticSignIn(page);
  1708 |     await page.goto(`${DASHBOARD_PATH}ai`);
  1709 | 
  1710 |     await page
  1711 |       .getByRole("button", { name: accepted.question, exact: true })
  1712 |       .click();
  1713 |     await expect(
  1714 |       page.getByText(accepted.answer, { exact: true }).last(),
  1715 |     ).toBeVisible();
  1716 |     await expect(
  1717 |       page.getByText(`${accepted.source}:42`, { exact: false }).last(),
  1718 |     ).toBeVisible();
  1719 |     await expect(
  1720 |       page.getByText("Accepted: source span verified.", { exact: true }).last(),
  1721 |     ).toBeVisible();
  1722 | 
  1723 |     await page.getByRole("combobox").selectOption("e2e-project-two");
  1724 |     await expect(
  1725 |       page.getByRole("button", { name: blocked.question, exact: true }),
  1726 |     ).toBeVisible();
  1727 |     await expect(page.getByText(accepted.answer, { exact: true })).toHaveCount(
  1728 |       0,
  1729 |     );
  1730 |     await page
```