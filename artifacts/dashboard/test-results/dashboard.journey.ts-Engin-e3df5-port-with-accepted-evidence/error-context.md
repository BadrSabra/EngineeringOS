# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: dashboard.journey.ts >> EngineeringOS dashboard browser journey >> keeps the AI session drawer overlaid on a phone viewport with accepted evidence
- Location: e2e/dashboard.journey.ts:1579:3

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
  1501 |     await page.getByRole("button", { name: "Newer" }).click();
  1502 |     await expect(page.getByText("Page 1.", { exact: false })).toBeVisible();
  1503 |     await expect(page.getByText("Filtered release event 0", { exact: true })).toBeVisible();
  1504 | 
  1505 |     await page.getByPlaceholder("Search logs...").fill("Filtered release");
  1506 |     await page.getByRole("button", { name: "Toggle event filters" }).click();
  1507 |     await page.locator("select").nth(1).selectOption("success");
  1508 |     await expect(page.getByText("Filtered release event 0", { exact: true })).toBeVisible();
  1509 |     await expect(page.getByText("Older event 1", { exact: true })).not.toBeVisible();
  1510 |     await expect(page).toHaveURL(/search=Filtered\+release/);
  1511 |     await expect(page).toHaveURL(/severity=success/);
  1512 | 
  1513 |     await page.reload();
  1514 |     await expect(page.getByText("Filtered release event 0", { exact: true })).toBeVisible();
  1515 |     await expect(page.getByText("Older event 1", { exact: true })).not.toBeVisible();
  1516 |     await expect(page.getByPlaceholder("Search logs...")).toHaveValue("Filtered release");
  1517 |     await page.getByRole("button", { name: "Toggle event filters" }).click();
  1518 |     await expect(page.locator("select").nth(1)).toHaveValue("success");
  1519 |     const filteredRequest = new URL(eventRequests.at(-1)!);
  1520 |     expect(filteredRequest.searchParams.get("limit")).toBe("50");
  1521 |     expect(filteredRequest.searchParams.get("page")).toBe("1");
  1522 |     expect(filteredRequest.searchParams.get("search")).toBe("Filtered release");
  1523 |     expect(filteredRequest.searchParams.get("severity")).toBe("success");
  1524 |   });
  1525 | 
  1526 |   test("renders an Arabic source-backed AI answer without internal diagnostics", async ({
  1527 |     page,
  1528 |   }) => {
  1529 |     const fixture = await installArabicAiFixture(page);
  1530 |     await installApiFixtures(page, { arabicAi: fixture });
  1531 |     await programmaticSignIn(page);
  1532 |     await page.goto(`${DASHBOARD_PATH}ai`);
  1533 | 
  1534 |     const composer = page.locator("textarea").first();
  1535 |     await expect(composer).toBeVisible();
  1536 |     await composer.fill(fixture.question);
  1537 |     const sendButton = composer.locator("xpath=..").getByRole("button");
  1538 |     await expect(sendButton).toBeEnabled();
  1539 |     const streamResponsePromise = page.waitForResponse((response) =>
  1540 |       response.url().includes("/api/ai/chat/stream"),
  1541 |     );
  1542 |     await sendButton.click();
  1543 |     const streamResponse = await streamResponsePromise;
  1544 |     expect(streamResponse.status()).toBe(200);
  1545 | 
  1546 |     await expect(
  1547 |       page.getByText(fixture.question, { exact: true }).last(),
  1548 |     ).toBeVisible();
  1549 |     await expect(
  1550 |       page.getByText(fixture.answer, { exact: true }).last(),
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
> 1601 |     ).toBeVisible();
       |       ^ Error: expect(locator).toBeVisible() failed
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
  1651 |     await composer.fill(fixture.question);
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
```