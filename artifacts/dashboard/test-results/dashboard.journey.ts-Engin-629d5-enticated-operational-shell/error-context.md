# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: dashboard.journey.ts >> EngineeringOS dashboard browser journey >> signs in and traverses the authenticated operational shell
- Location: e2e/dashboard.journey.ts:1562:3

# Error details

```
Error: expect(locator).toBeVisible() failed

Locator: getByText('Showing 1–1 of 1', { exact: true })
Expected: visible
Timeout: 10000ms
Error: element(s) not found

Call log:
  - Expect "toBeVisible" with timeout 10000ms
  - waiting for getByText('Showing 1–1 of 1', { exact: true })

```

```yaml
- text: EngineeringOS Core Ops
- link "Dashboard":
  - /url: /dashboard/
- link "Projects":
  - /url: /dashboard/projects
- link "Tasks":
  - /url: /dashboard/tasks
- link "Rules Engine":
  - /url: /dashboard/rules
- link "Workflows":
  - /url: /dashboard/workflows
- link "Event Stream":
  - /url: /dashboard/events
- link "Metrics":
  - /url: /dashboard/metrics
- link "Knowledge Graph":
  - /url: /dashboard/graph
- link "AI Assistant":
  - /url: /dashboard/ai
- link "Flight Deck":
  - /url: /dashboard/flight-deck
- link "Mission Control":
  - /url: /dashboard/mission-control
- text: ED EngineeringOS Dashboard Smoke Connected
- button "Sign out"
- banner:
  - textbox "Search projects, tasks, rules... (Press '/')"
  - text: v1.0.4-stable
  - button
- main:
  - heading "System Overview" [level=1]
  - paragraph: Real-time status of all autonomous engineering operations.
  - text: Updated 12:56:10 AM
  - button "Refresh status"
  - text: SYSTEM ONLINE
  - region "AI diagnostics retention health":
    - heading "AI diagnostics retention" [level=2]
    - text: Healthy
    - paragraph: Last completed 8/24/2026, 12:56:02 AM
    - text: Chat rows 0 scanned / 0 pruned Execution rows 0 scanned / 0 pruned
  - heading "Active Projects" [level=3]
  - text: 1 0 tasks pending
  - heading "Active Tasks" [level=3]
  - text: 0 0 currently executing
  - heading "Tasks Completed" [level=3]
  - text: 2 100% success rate
  - heading "Failed Tasks" [level=3]
  - text: 0 Require attention
  - heading "Project Health" [level=2]
  - link "View All":
    - /url: /dashboard/projects
  - table:
    - rowgroup:
      - row "Project Score Trend Quality Bar":
        - columnheader "Project"
        - columnheader "Score"
        - columnheader "Trend"
        - columnheader "Quality Bar"
    - rowgroup:
      - row "Smoke Project 92 / 100 → stable":
        - cell "Smoke Project"
        - cell "92 / 100"
        - cell "→ stable"
        - cell
  - heading "Event Stream" [level=2]
  - link "View All":
    - /url: /dashboard/events
  - text: Dashboard API fixture ready 12:00:00 AM
- region "Notifications (F8)":
  - list
```

# Test source

```ts
  1486 |         status: execution.status,
  1487 |         flightState: execution.flightState,
  1488 |       },
  1489 |       messages: messages.map(
  1490 |         ({
  1491 |           id,
  1492 |           sessionId: messageSession,
  1493 |           role,
  1494 |           executionId: messageExecution,
  1495 |           outcome,
  1496 |         }) => ({
  1497 |           id,
  1498 |           sessionId: messageSession,
  1499 |           role,
  1500 |           executionId: messageExecution,
  1501 |           outcome,
  1502 |         }),
  1503 |       ),
  1504 |       sseEvents: sseEvents.map(
  1505 |         ({
  1506 |           type,
  1507 |           executionId: eventExecution,
  1508 |           sessionId: eventSession,
  1509 |           outcome,
  1510 |           code,
  1511 |         }) => ({
  1512 |           type,
  1513 |           executionId: eventExecution,
  1514 |           sessionId: eventSession,
  1515 |           outcome,
  1516 |           code,
  1517 |         }),
  1518 |       ),
  1519 |       checkpoints: [
  1520 |         {
  1521 |           sequence: checkpoint.sequence,
  1522 |           stage: checkpoint.stage,
  1523 |           updatedAt: checkpoint.updatedAt,
  1524 |         },
  1525 |       ],
  1526 |       evidenceCount,
  1527 |       proposals: proposal
  1528 |         ? [
  1529 |             {
  1530 |               id: proposal.id,
  1531 |               revision: proposal.revision,
  1532 |               status: proposal.status,
  1533 |             },
  1534 |           ]
  1535 |         : [],
  1536 |       validation: validation.map((step) => ({
  1537 |         status: step.validation?.status ?? step.status,
  1538 |         profile: step.validation?.profile ?? step.validationProfile,
  1539 |       })),
  1540 |       events: events.map(({ type, severity, correlationId }) => ({
  1541 |         type,
  1542 |         severity,
  1543 |         correlationId,
  1544 |       })),
  1545 |       dashboard: missionControl,
  1546 |       dashboardState: {
  1547 |         projectCount: dashboardState.projectCount,
  1548 |         activeTaskCount: dashboardState.activeTaskCount,
  1549 |       },
  1550 |     };
  1551 |     const outputPath =
  1552 |       process.env.DASHBOARD_E2E_LIVE_REPORT_PATH ??
  1553 |       "test-results/dashboard-journey/live-mission-correlation.json";
  1554 |     await mkdir(dirname(outputPath), { recursive: true });
  1555 |     await writeFile(
  1556 |       outputPath,
  1557 |       `${JSON.stringify(capture, null, 2)}\n`,
  1558 |       "utf8",
  1559 |     );
  1560 |   });
  1561 | 
  1562 |   test("signs in and traverses the authenticated operational shell", async ({
  1563 |     page,
  1564 |   }) => {
  1565 |     await installApiFixtures(page);
  1566 |     await programmaticSignIn(page);
  1567 |     for (const origin of approvedDashboardOrigins()) {
  1568 |       await expectOriginCanUseApi(page, origin);
  1569 |     }
  1570 |     await expectHostileOriginRejected(page);
  1571 | 
  1572 |     await expect(
  1573 |       page.getByRole("heading", { name: "System Overview" }),
  1574 |     ).toBeVisible();
  1575 |     await expect(
  1576 |       page.getByText("SYSTEM ONLINE", { exact: true }),
  1577 |     ).toBeVisible();
  1578 |     await expect(
  1579 |       page.getByText("Smoke Project", { exact: true }).first(),
  1580 |     ).toBeVisible();
  1581 |     await expect(
  1582 |       page.getByText("Dashboard API fixture ready", { exact: true }),
  1583 |     ).toBeVisible();
  1584 |     await expect(
  1585 |       page.getByText("Showing 1–1 of 1", { exact: true }),
> 1586 |     ).toBeVisible();
       |       ^ Error: expect(locator).toBeVisible() failed
  1587 |     await expect(page.getByRole("button", { name: "Older" })).toBeDisabled();
  1588 | 
  1589 |     await openNavigation(page, "Projects", `${DASHBOARD_PATH}projects`);
  1590 |     await expect(page.getByRole("heading", { name: "Projects" })).toBeVisible();
  1591 |     await expect(
  1592 |       page.getByText("Smoke Project", { exact: true }),
  1593 |     ).toBeVisible();
  1594 | 
  1595 |     await openNavigation(page, "Event Stream", `${DASHBOARD_PATH}events`);
  1596 |     await expect(
  1597 |       page.getByRole("heading", { name: "Event Stream" }),
  1598 |     ).toBeVisible();
  1599 |     await expect(
  1600 |       page.getByText("Dashboard API fixture ready", { exact: true }),
  1601 |     ).toBeVisible();
  1602 | 
  1603 |     await openNavigation(page, "AI Assistant", `${DASHBOARD_PATH}ai`);
  1604 |     await expect(page).not.toHaveURL(/sign-in/);
  1605 |     await expect(
  1606 |       page
  1607 |         .getByText(
  1608 |           /AI provider not configured|No AI key configured|AI Assistant/i,
  1609 |         )
  1610 |         .first(),
  1611 |     ).toBeVisible();
  1612 | 
  1613 |     await openNavigation(
  1614 |       page,
  1615 |       "Mission Control",
  1616 |       `${DASHBOARD_PATH}mission-control`,
  1617 |     );
  1618 |     await expect(
  1619 |       page.getByRole("heading", { name: "No durable runs in the ledger" }),
  1620 |     ).toBeVisible();
  1621 | 
  1622 |     await page.goto(`${DASHBOARD_PATH}flight-deck?executionId=${EXECUTION_ID}`);
  1623 |     await expect(page).toHaveURL(
  1624 |       new RegExp(
  1625 |         `${DASHBOARD_PATH.replaceAll("/", "\\/")}flight-deck\\?executionId=`,
  1626 |       ),
  1627 |     );
  1628 |     await expect(
  1629 |       page.getByRole("heading", { name: "Audit / Chat run" }),
  1630 |     ).toBeVisible();
  1631 |     await expect(
  1632 |       page.getByText("Controlled browser fixture completed.", { exact: true }),
  1633 |     ).toBeVisible();
  1634 |     await expect(
  1635 |       page.getByText("PROVEN", { exact: true }).first(),
  1636 |     ).toBeVisible();
  1637 |   });
  1638 | 
  1639 |   test("previews and downloads the completed execution audit without duplicating effects", async ({
  1640 |     page,
  1641 |   }) => {
  1642 |     const auditRequests: string[] = [];
  1643 |     const auditBody = {
  1644 |       format: "engineeringos.execution-audit.v1",
  1645 |       exportedAt: "2026-01-01T00:02:00.000Z",
  1646 |       execution: {
  1647 |         id: EXECUTION_ID,
  1648 |         projectId: "e2e-project",
  1649 |         sessionId: "e2e-audit-session",
  1650 |         operationId: executionFixture.operationId,
  1651 |         status: "completed",
  1652 |         terminalState: "completed",
  1653 |         revision: "e2e-revision-42",
  1654 |         proof: { required: false, verdict: "PROVEN" },
  1655 |       },
  1656 |       timeline: [],
  1657 |       validations: [{ status: "passed", profile: "release-safe" }],
  1658 |       affectedFiles: ["src/feature.ts"],
  1659 |       redaction: {
  1660 |         excluded: [
  1661 |           "provider secrets",
  1662 |           "raw model output",
  1663 |           "private runtime paths",
  1664 |         ],
  1665 |       },
  1666 |     };
  1667 |     await installApiFixtures(page, {
  1668 |       auditExport: {
  1669 |         body: auditBody,
  1670 |         filename: "server-supplied-audit-name.json",
  1671 |         requests: auditRequests,
  1672 |       },
  1673 |     });
  1674 |     await programmaticSignIn(page);
  1675 |     await page.evaluate(() => {
  1676 |       const execution = {
  1677 |         id: "e2e-controlled-execution",
  1678 |         projectId: "e2e-project",
  1679 |         sessionId: "e2e-audit-session",
  1680 |         message: "Completed audit execution",
  1681 |       };
  1682 |       localStorage.setItem(
  1683 |         "eos_ai_execution_current_e2e-project",
  1684 |         "e2e-audit-session",
  1685 |       );
  1686 |       localStorage.setItem(
```