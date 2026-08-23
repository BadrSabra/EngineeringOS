# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: dashboard.journey.ts >> EngineeringOS dashboard browser journey >> renders an Arabic source-backed AI answer without internal diagnostics
- Location: e2e/dashboard.journey.ts:1510:3

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
  1460 |       ],
  1461 |     });
  1462 |     await programmaticSignIn(page);
  1463 |     await page.goto(`${DASHBOARD_PATH}events`);
  1464 | 
  1465 |     await expect(page.getByText("Older event 49", { exact: true })).toBeVisible();
  1466 |     await expect(page.getByText("Older event 50", { exact: true })).not.toBeVisible();
  1467 |     const firstRequest = new URL(eventRequests.at(-1)!);
  1468 |     expect(firstRequest.searchParams.get("limit")).toBe("50");
  1469 |     expect(firstRequest.searchParams.get("page")).toBe("1");
  1470 | 
  1471 |     await Promise.all([
  1472 |       page.waitForRequest((request) => {
  1473 |         const url = new URL(request.url());
  1474 |         return (
  1475 |           url.pathname.endsWith("/api/events") &&
  1476 |           url.searchParams.get("page") === "2"
  1477 |         );
  1478 |       }),
  1479 |       page.getByRole("button", { name: "Older" }).click(),
  1480 |     ]);
  1481 |     await expect(page.getByText("Page 2.", { exact: false })).toBeVisible();
  1482 |     await expect(page.getByText("Older event 50", { exact: true })).toBeVisible();
  1483 |     await expect(page.getByText("Filtered release event 0", { exact: true })).not.toBeVisible();
  1484 |     expect(new URL(eventRequests.at(-1)!).searchParams.get("page")).toBe("2");
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
> 1560 |     expect(visibleText).toContain("The required analysis did not complete.");
       |                         ^ Error: expect(received).toContain(expected) // indexOf
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
```