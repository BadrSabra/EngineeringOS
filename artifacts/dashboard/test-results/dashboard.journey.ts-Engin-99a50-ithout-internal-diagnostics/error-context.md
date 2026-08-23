# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: dashboard.journey.ts >> EngineeringOS dashboard browser journey >> renders an Arabic source-backed AI answer without internal diagnostics
- Location: e2e/dashboard.journey.ts:1526:3

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
Get a free key at openrouter.ai/keys — routes to 300+ models, used first when configured.·
Save
GEMINI API KEY
Free · Priority·
Free key at aistudio.google.com/apikey — 1,500 req/day, 1M tokens/day.·
Save
DEEPSEEK API KEY
Optional·
Get a free API key at platform.deepseek.com to use DeepSeek as your AI provider.·
Save
GROQ API KEY·
No personal key saved — the server's key will be used if one is configured.·
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
                - paragraph [ref=f2e118]: Get a free key at openrouter.ai/keys — routes to 300+ models, used first when configured.
                - generic [ref=f2e119]:
                  - textbox "sk-or-…" [ref=f2e120]
                  - button "Save" [disabled]
              - generic [ref=f2e121]:
                - generic [ref=f2e122]:
                  - generic [ref=f2e127]: Gemini API Key
                  - generic [ref=f2e128]: Free · Priority
                - paragraph [ref=f2e129]: Free key at aistudio.google.com/apikey — 1,500 req/day, 1M tokens/day.
                - generic [ref=f2e130]:
                  - textbox "AIza…" [ref=f2e131]
                  - button "Save" [ref=f2e132]
              - generic [ref=f2e133]:
                - generic [ref=f2e134]:
                  - generic [ref=f2e139]: DeepSeek API Key
                  - generic [ref=f2e140]: Optional
                - paragraph [ref=f2e141]: Get a free API key at platform.deepseek.com to use DeepSeek as your AI provider.
                - generic [ref=f2e142]:
                  - textbox "sk-…" [ref=f2e143]
                  - button "Save" [disabled]
              - generic [ref=f2e144]:
                - generic [ref=f2e145]: Groq API Key
                - paragraph [ref=f2e151]: No personal key saved — the server's key will be used if one is configured.
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
  1476 |       ],
  1477 |     });
  1478 |     await programmaticSignIn(page);
  1479 |     await page.goto(`${DASHBOARD_PATH}events`);
  1480 | 
  1481 |     await expect(page.getByText("Older event 49", { exact: true })).toBeVisible();
  1482 |     await expect(page.getByText("Older event 50", { exact: true })).not.toBeVisible();
  1483 |     const firstRequest = new URL(eventRequests.at(-1)!);
  1484 |     expect(firstRequest.searchParams.get("limit")).toBe("50");
  1485 |     expect(firstRequest.searchParams.get("page")).toBe("1");
  1486 | 
  1487 |     await Promise.all([
  1488 |       page.waitForRequest((request) => {
  1489 |         const url = new URL(request.url());
  1490 |         return (
  1491 |           url.pathname.endsWith("/api/events") &&
  1492 |           url.searchParams.get("page") === "2"
  1493 |         );
  1494 |       }),
  1495 |       page.getByRole("button", { name: "Older" }).click(),
  1496 |     ]);
  1497 |     await expect(page.getByText("Page 2.", { exact: false })).toBeVisible();
  1498 |     await expect(page.getByText("Older event 50", { exact: true })).toBeVisible();
  1499 |     await expect(page.getByText("Filtered release event 0", { exact: true })).not.toBeVisible();
  1500 |     expect(new URL(eventRequests.at(-1)!).searchParams.get("page")).toBe("2");
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
> 1576 |     expect(visibleText).toContain("The required analysis did not complete.");
       |                         ^ Error: expect(received).toContain(expected) // indexOf
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
```