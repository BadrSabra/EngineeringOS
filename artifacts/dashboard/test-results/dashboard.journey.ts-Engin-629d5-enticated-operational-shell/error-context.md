# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: dashboard.journey.ts >> EngineeringOS dashboard browser journey >> signs in and traverses the authenticated operational shell
- Location: e2e/dashboard.journey.ts:1590:3

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
  - text: Updated 11:41:29 AM
  - button "Refresh status"
  - text: SYSTEM ONLINE
  - region "AI diagnostics retention health":
    - heading "AI diagnostics retention" [level=2]
    - text: Healthy
    - paragraph: Last completed 8/24/2026, 11:41:03 AM
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
  1514 |         status: execution.status,
  1515 |         flightState: execution.flightState,
  1516 |       },
  1517 |       messages: messages.map(
  1518 |         ({
  1519 |           id,
  1520 |           sessionId: messageSession,
  1521 |           role,
  1522 |           executionId: messageExecution,
  1523 |           outcome,
  1524 |         }) => ({
  1525 |           id,
  1526 |           sessionId: messageSession,
  1527 |           role,
  1528 |           executionId: messageExecution,
  1529 |           outcome,
  1530 |         }),
  1531 |       ),
  1532 |       sseEvents: sseEvents.map(
  1533 |         ({
  1534 |           type,
  1535 |           executionId: eventExecution,
  1536 |           sessionId: eventSession,
  1537 |           outcome,
  1538 |           code,
  1539 |         }) => ({
  1540 |           type,
  1541 |           executionId: eventExecution,
  1542 |           sessionId: eventSession,
  1543 |           outcome,
  1544 |           code,
  1545 |         }),
  1546 |       ),
  1547 |       checkpoints: [
  1548 |         {
  1549 |           sequence: checkpoint.sequence,
  1550 |           stage: checkpoint.stage,
  1551 |           updatedAt: checkpoint.updatedAt,
  1552 |         },
  1553 |       ],
  1554 |       evidenceCount,
  1555 |       proposals: proposal
  1556 |         ? [
  1557 |             {
  1558 |               id: proposal.id,
  1559 |               revision: proposal.revision,
  1560 |               status: proposal.status,
  1561 |             },
  1562 |           ]
  1563 |         : [],
  1564 |       validation: validation.map((step) => ({
  1565 |         status: step.validation?.status ?? step.status,
  1566 |         profile: step.validation?.profile ?? step.validationProfile,
  1567 |       })),
  1568 |       events: events.map(({ type, severity, correlationId }) => ({
  1569 |         type,
  1570 |         severity,
  1571 |         correlationId,
  1572 |       })),
  1573 |       dashboard: missionControl,
  1574 |       dashboardState: {
  1575 |         projectCount: dashboardState.projectCount,
  1576 |         activeTaskCount: dashboardState.activeTaskCount,
  1577 |       },
  1578 |     };
  1579 |     const outputPath =
  1580 |       process.env.DASHBOARD_E2E_LIVE_REPORT_PATH ??
  1581 |       "test-results/dashboard-journey/live-mission-correlation.json";
  1582 |     await mkdir(dirname(outputPath), { recursive: true });
  1583 |     await writeFile(
  1584 |       outputPath,
  1585 |       `${JSON.stringify(capture, null, 2)}\n`,
  1586 |       "utf8",
  1587 |     );
  1588 |   });
  1589 | 
  1590 |   test("signs in and traverses the authenticated operational shell", async ({
  1591 |     page,
  1592 |   }) => {
  1593 |     await installApiFixtures(page);
  1594 |     await programmaticSignIn(page);
  1595 |     for (const origin of approvedDashboardOrigins()) {
  1596 |       await expectOriginCanUseApi(page, origin);
  1597 |     }
  1598 |     await expectHostileOriginRejected(page);
  1599 | 
  1600 |     await expect(
  1601 |       page.getByRole("heading", { name: "System Overview" }),
  1602 |     ).toBeVisible();
  1603 |     await expect(
  1604 |       page.getByText("SYSTEM ONLINE", { exact: true }),
  1605 |     ).toBeVisible();
  1606 |     await expect(
  1607 |       page.getByText("Smoke Project", { exact: true }).first(),
  1608 |     ).toBeVisible();
  1609 |     await expect(
  1610 |       page.getByText("Dashboard API fixture ready", { exact: true }),
  1611 |     ).toBeVisible();
  1612 |     await expect(
  1613 |       page.getByText("Showing 1–1 of 1", { exact: true }),
> 1614 |     ).toBeVisible();
       |       ^ Error: expect(locator).toBeVisible() failed
  1615 |     await expect(page.getByRole("button", { name: "Older" })).toBeDisabled();
  1616 | 
  1617 |     await openNavigation(page, "Projects", `${DASHBOARD_PATH}projects`);
  1618 |     await expect(page.getByRole("heading", { name: "Projects" })).toBeVisible();
  1619 |     await expect(
  1620 |       page.getByText("Smoke Project", { exact: true }),
  1621 |     ).toBeVisible();
  1622 | 
  1623 |     await openNavigation(page, "Event Stream", `${DASHBOARD_PATH}events`);
  1624 |     await expect(
  1625 |       page.getByRole("heading", { name: "Event Stream" }),
  1626 |     ).toBeVisible();
  1627 |     await expect(
  1628 |       page.getByText("Dashboard API fixture ready", { exact: true }),
  1629 |     ).toBeVisible();
  1630 | 
  1631 |     await openNavigation(page, "AI Assistant", `${DASHBOARD_PATH}ai`);
  1632 |     await expect(page).not.toHaveURL(/sign-in/);
  1633 |     await expect(
  1634 |       page
  1635 |         .getByText(
  1636 |           /AI provider not configured|No AI key configured|AI Assistant/i,
  1637 |         )
  1638 |         .first(),
  1639 |     ).toBeVisible();
  1640 | 
  1641 |     await openNavigation(
  1642 |       page,
  1643 |       "Mission Control",
  1644 |       `${DASHBOARD_PATH}mission-control`,
  1645 |     );
  1646 |     await expect(
  1647 |       page.getByRole("heading", { name: "No durable runs in the ledger" }),
  1648 |     ).toBeVisible();
  1649 | 
  1650 |     await page.goto(`${DASHBOARD_PATH}flight-deck?executionId=${EXECUTION_ID}`);
  1651 |     await expect(page).toHaveURL(
  1652 |       new RegExp(
  1653 |         `${DASHBOARD_PATH.replaceAll("/", "\\/")}flight-deck\\?executionId=`,
  1654 |       ),
  1655 |     );
  1656 |     await expect(
  1657 |       page.getByRole("heading", { name: "Audit / Chat run" }),
  1658 |     ).toBeVisible();
  1659 |     await expect(
  1660 |       page.getByText("Controlled browser fixture completed.", { exact: true }),
  1661 |     ).toBeVisible();
  1662 |     await expect(
  1663 |       page.getByText("PROVEN", { exact: true }).first(),
  1664 |     ).toBeVisible();
  1665 |   });
  1666 | 
  1667 |   test("previews and downloads the completed execution audit without duplicating effects", async ({
  1668 |     page,
  1669 |   }) => {
  1670 |     const auditRequests: string[] = [];
  1671 |     const auditBody = {
  1672 |       format: "engineeringos.execution-audit.v1",
  1673 |       exportedAt: "2026-01-01T00:02:00.000Z",
  1674 |       execution: {
  1675 |         id: EXECUTION_ID,
  1676 |         projectId: "e2e-project",
  1677 |         sessionId: "e2e-audit-session",
  1678 |         operationId: executionFixture.operationId,
  1679 |         status: "completed",
  1680 |         terminalState: "completed",
  1681 |         revision: "e2e-revision-42",
  1682 |         proof: { required: false, verdict: "PROVEN" },
  1683 |       },
  1684 |       timeline: [],
  1685 |       validations: [{ status: "passed", profile: "release-safe" }],
  1686 |       affectedFiles: ["src/feature.ts"],
  1687 |       redaction: {
  1688 |         excluded: [
  1689 |           "provider secrets",
  1690 |           "raw model output",
  1691 |           "private runtime paths",
  1692 |         ],
  1693 |       },
  1694 |     };
  1695 |     await installApiFixtures(page, {
  1696 |       auditExport: {
  1697 |         body: auditBody,
  1698 |         filename: "server-supplied-audit-name.json",
  1699 |         requests: auditRequests,
  1700 |       },
  1701 |     });
  1702 |     await programmaticSignIn(page);
  1703 |     await page.evaluate(() => {
  1704 |       const execution = {
  1705 |         id: "e2e-controlled-execution",
  1706 |         projectId: "e2e-project",
  1707 |         sessionId: "e2e-audit-session",
  1708 |         message: "Completed audit execution",
  1709 |       };
  1710 |       localStorage.setItem(
  1711 |         "eos_ai_execution_current_e2e-project",
  1712 |         "e2e-audit-session",
  1713 |       );
  1714 |       localStorage.setItem(
```