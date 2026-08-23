# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: dashboard.journey.ts >> EngineeringOS dashboard browser journey >> keeps the AI session drawer overlaid on a phone viewport with accepted evidence
- Location: e2e/dashboard.journey.ts:1563:3

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
  1485 |     await page.getByRole("button", { name: "Newer" }).click();
  1486 |     await expect(page.getByText("Page 1.", { exact: false })).toBeVisible();
  1487 |     await expect(page.getByText("Filtered release event 0", { exact: true })).toBeVisible();
  1488 | 
  1489 |     await page.getByPlaceholder("Search logs...").fill("Filtered release");
  1490 |     await page.getByRole("button", { name: "Toggle event filters" }).click();
  1491 |     await page.locator("select").nth(1).selectOption("success");
  1492 |     await expect(page.getByText("Filtered release event 0", { exact: true })).toBeVisible();
  1493 |     await expect(page.getByText("Older event 1", { exact: true })).not.toBeVisible();
  1494 |     await expect(page).toHaveURL(/search=Filtered\+release/);
  1495 |     await expect(page).toHaveURL(/severity=success/);
  1496 | 
  1497 |     await page.reload();
  1498 |     await expect(page.getByText("Filtered release event 0", { exact: true })).toBeVisible();
  1499 |     await expect(page.getByText("Older event 1", { exact: true })).not.toBeVisible();
  1500 |     await expect(page.getByPlaceholder("Search logs...")).toHaveValue("Filtered release");
  1501 |     await page.getByRole("button", { name: "Toggle event filters" }).click();
  1502 |     await expect(page.locator("select").nth(1)).toHaveValue("success");
  1503 |     const filteredRequest = new URL(eventRequests.at(-1)!);
  1504 |     expect(filteredRequest.searchParams.get("limit")).toBe("50");
  1505 |     expect(filteredRequest.searchParams.get("page")).toBe("1");
  1506 |     expect(filteredRequest.searchParams.get("search")).toBe("Filtered release");
  1507 |     expect(filteredRequest.searchParams.get("severity")).toBe("success");
  1508 |   });
  1509 | 
  1510 |   test("renders an Arabic source-backed AI answer without internal diagnostics", async ({
  1511 |     page,
  1512 |   }) => {
  1513 |     const fixture = await installArabicAiFixture(page);
  1514 |     await installApiFixtures(page, { arabicAi: fixture });
  1515 |     await programmaticSignIn(page);
  1516 |     await page.goto(`${DASHBOARD_PATH}ai`);
  1517 | 
  1518 |     const composer = page.locator("textarea").first();
  1519 |     await expect(composer).toBeVisible();
  1520 |     await composer.fill(fixture.question);
  1521 |     const sendButton = composer.locator("xpath=..").getByRole("button");
  1522 |     await expect(sendButton).toBeEnabled();
  1523 |     const streamResponsePromise = page.waitForResponse((response) =>
  1524 |       response.url().includes("/api/ai/chat/stream"),
  1525 |     );
  1526 |     await sendButton.click();
  1527 |     const streamResponse = await streamResponsePromise;
  1528 |     expect(streamResponse.status()).toBe(200);
  1529 | 
  1530 |     await expect(
  1531 |       page.getByText(fixture.question, { exact: true }).last(),
  1532 |     ).toBeVisible();
  1533 |     await expect(
  1534 |       page.getByText(fixture.answer, { exact: true }).last(),
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
> 1585 |     ).toBeVisible();
       |       ^ Error: expect(locator).toBeVisible() failed
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
  1635 |     await composer.fill(fixture.question);
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
```