# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: dashboard.journey.ts >> EngineeringOS dashboard browser journey >> renders an Arabic source-backed AI answer without internal diagnostics
- Location: e2e/dashboard.journey.ts:1505:3

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
  1455 |       ],
  1456 |     });
  1457 |     await programmaticSignIn(page);
  1458 |     await page.goto(`${DASHBOARD_PATH}events`);
  1459 | 
  1460 |     await expect(page.getByText("Older event 49", { exact: true })).toBeVisible();
  1461 |     await expect(page.getByText("Older event 50", { exact: true })).not.toBeVisible();
  1462 |     const firstRequest = new URL(eventRequests.at(-1)!);
  1463 |     expect(firstRequest.searchParams.get("limit")).toBe("50");
  1464 |     expect(firstRequest.searchParams.get("page")).toBe("1");
  1465 | 
  1466 |     await Promise.all([
  1467 |       page.waitForRequest((request) => {
  1468 |         const url = new URL(request.url());
  1469 |         return (
  1470 |           url.pathname.endsWith("/api/events") &&
  1471 |           url.searchParams.get("page") === "2"
  1472 |         );
  1473 |       }),
  1474 |       page.getByRole("button", { name: "Older" }).click(),
  1475 |     ]);
  1476 |     await expect(page.getByText("Page 2.", { exact: false })).toBeVisible();
  1477 |     await expect(page.getByText("Older event 50", { exact: true })).toBeVisible();
  1478 |     await expect(page.getByText("Filtered release event 0", { exact: true })).not.toBeVisible();
  1479 |     expect(new URL(eventRequests.at(-1)!).searchParams.get("page")).toBe("2");
  1480 |     await page.getByRole("button", { name: "Newer" }).click();
  1481 |     await expect(page.getByText("Page 1.", { exact: false })).toBeVisible();
  1482 |     await expect(page.getByText("Filtered release event 0", { exact: true })).toBeVisible();
  1483 | 
  1484 |     await page.getByPlaceholder("Search logs...").fill("Filtered release");
  1485 |     await page.getByRole("button", { name: "Toggle event filters" }).click();
  1486 |     await page.locator("select").nth(1).selectOption("success");
  1487 |     await expect(page.getByText("Filtered release event 0", { exact: true })).toBeVisible();
  1488 |     await expect(page.getByText("Older event 1", { exact: true })).not.toBeVisible();
  1489 |     await expect(page).toHaveURL(/search=Filtered\+release/);
  1490 |     await expect(page).toHaveURL(/severity=success/);
  1491 | 
  1492 |     await page.reload();
  1493 |     await expect(page.getByText("Filtered release event 0", { exact: true })).toBeVisible();
  1494 |     await expect(page.getByText("Older event 1", { exact: true })).not.toBeVisible();
  1495 |     await expect(page.getByPlaceholder("Search logs...")).toHaveValue("Filtered release");
  1496 |     await page.getByRole("button", { name: "Toggle event filters" }).click();
  1497 |     await expect(page.locator("select").nth(1)).toHaveValue("success");
  1498 |     const filteredRequest = new URL(eventRequests.at(-1)!);
  1499 |     expect(filteredRequest.searchParams.get("limit")).toBe("50");
  1500 |     expect(filteredRequest.searchParams.get("page")).toBe("1");
  1501 |     expect(filteredRequest.searchParams.get("search")).toBe("Filtered release");
  1502 |     expect(filteredRequest.searchParams.get("severity")).toBe("success");
  1503 |   });
  1504 | 
  1505 |   test("renders an Arabic source-backed AI answer without internal diagnostics", async ({
  1506 |     page,
  1507 |   }) => {
  1508 |     const fixture = await installArabicAiFixture(page);
  1509 |     await installApiFixtures(page, { arabicAi: fixture });
  1510 |     await programmaticSignIn(page);
  1511 |     await page.goto(`${DASHBOARD_PATH}ai`);
  1512 | 
  1513 |     const composer = page.locator("textarea").first();
  1514 |     await expect(composer).toBeVisible();
  1515 |     await composer.fill(fixture.question);
  1516 |     const sendButton = composer.locator("xpath=..").getByRole("button");
  1517 |     await expect(sendButton).toBeEnabled();
  1518 |     const streamResponsePromise = page.waitForResponse((response) =>
  1519 |       response.url().includes("/api/ai/chat/stream"),
  1520 |     );
  1521 |     await sendButton.click();
  1522 |     const streamResponse = await streamResponsePromise;
  1523 |     expect(streamResponse.status()).toBe(200);
  1524 | 
  1525 |     await expect(
  1526 |       page.getByText(fixture.question, { exact: true }).last(),
  1527 |     ).toBeVisible();
  1528 |     await expect(
  1529 |       page.getByText(fixture.answer, { exact: true }).last(),
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
> 1555 |     expect(visibleText).toContain("The required analysis did not complete.");
       |                         ^ Error: expect(received).toContain(expected) // indexOf
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
  1630 |     await composer.fill(fixture.question);
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
```