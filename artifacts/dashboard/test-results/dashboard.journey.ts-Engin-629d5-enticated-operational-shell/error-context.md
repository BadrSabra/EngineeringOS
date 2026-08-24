# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: dashboard.journey.ts >> EngineeringOS dashboard browser journey >> signs in and traverses the authenticated operational shell
- Location: e2e/dashboard.journey.ts:1607:3

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
  - text: Updated 1:40:26 PM
  - button "Refresh status"
  - text: SYSTEM ONLINE
  - region "AI diagnostics retention health":
    - heading "AI diagnostics retention" [level=2]
    - text: Healthy
    - paragraph: Last completed 8/24/2026, 1:39:56 PM
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
  1531 |         status: execution.status,
  1532 |         flightState: execution.flightState,
  1533 |       },
  1534 |       messages: messages.map(
  1535 |         ({
  1536 |           id,
  1537 |           sessionId: messageSession,
  1538 |           role,
  1539 |           executionId: messageExecution,
  1540 |           outcome,
  1541 |         }) => ({
  1542 |           id,
  1543 |           sessionId: messageSession,
  1544 |           role,
  1545 |           executionId: messageExecution,
  1546 |           outcome,
  1547 |         }),
  1548 |       ),
  1549 |       sseEvents: sseEvents.map(
  1550 |         ({
  1551 |           type,
  1552 |           executionId: eventExecution,
  1553 |           sessionId: eventSession,
  1554 |           outcome,
  1555 |           code,
  1556 |         }) => ({
  1557 |           type,
  1558 |           executionId: eventExecution,
  1559 |           sessionId: eventSession,
  1560 |           outcome,
  1561 |           code,
  1562 |         }),
  1563 |       ),
  1564 |       checkpoints: [
  1565 |         {
  1566 |           sequence: checkpoint.sequence,
  1567 |           stage: checkpoint.stage,
  1568 |           updatedAt: checkpoint.updatedAt,
  1569 |         },
  1570 |       ],
  1571 |       evidenceCount,
  1572 |       proposals: proposal
  1573 |         ? [
  1574 |             {
  1575 |               id: proposal.id,
  1576 |               revision: proposal.revision,
  1577 |               status: proposal.status,
  1578 |             },
  1579 |           ]
  1580 |         : [],
  1581 |       validation: validation.map((step) => ({
  1582 |         status: step.validation?.status ?? step.status,
  1583 |         profile: step.validation?.profile ?? step.validationProfile,
  1584 |       })),
  1585 |       events: events.map(({ type, severity, correlationId }) => ({
  1586 |         type,
  1587 |         severity,
  1588 |         correlationId,
  1589 |       })),
  1590 |       dashboard: missionControl,
  1591 |       dashboardState: {
  1592 |         projectCount: dashboardState.projectCount,
  1593 |         activeTaskCount: dashboardState.activeTaskCount,
  1594 |       },
  1595 |     };
  1596 |     const outputPath =
  1597 |       process.env.DASHBOARD_E2E_LIVE_REPORT_PATH ??
  1598 |       "test-results/dashboard-journey/live-mission-correlation.json";
  1599 |     await mkdir(dirname(outputPath), { recursive: true });
  1600 |     await writeFile(
  1601 |       outputPath,
  1602 |       `${JSON.stringify(capture, null, 2)}\n`,
  1603 |       "utf8",
  1604 |     );
  1605 |   });
  1606 | 
  1607 |   test("signs in and traverses the authenticated operational shell", async ({
  1608 |     page,
  1609 |   }) => {
  1610 |     await installApiFixtures(page);
  1611 |     await programmaticSignIn(page);
  1612 |     for (const origin of approvedDashboardOrigins()) {
  1613 |       await expectOriginCanUseApi(page, origin);
  1614 |     }
  1615 |     await expectHostileOriginRejected(page);
  1616 | 
  1617 |     await expect(
  1618 |       page.getByRole("heading", { name: "System Overview" }),
  1619 |     ).toBeVisible();
  1620 |     await expect(
  1621 |       page.getByText("SYSTEM ONLINE", { exact: true }),
  1622 |     ).toBeVisible();
  1623 |     await expect(
  1624 |       page.getByText("Smoke Project", { exact: true }).first(),
  1625 |     ).toBeVisible();
  1626 |     await expect(
  1627 |       page.getByText("Dashboard API fixture ready", { exact: true }),
  1628 |     ).toBeVisible();
  1629 |     await expect(
  1630 |       page.getByText("Showing 1–1 of 1", { exact: true }),
> 1631 |     ).toBeVisible();
       |       ^ Error: expect(locator).toBeVisible() failed
  1632 |     await expect(page.getByRole("button", { name: "Older" })).toBeDisabled();
  1633 | 
  1634 |     await openNavigation(page, "Projects", `${DASHBOARD_PATH}projects`);
  1635 |     await expect(page.getByRole("heading", { name: "Projects" })).toBeVisible();
  1636 |     await expect(
  1637 |       page.getByText("Smoke Project", { exact: true }),
  1638 |     ).toBeVisible();
  1639 | 
  1640 |     await openNavigation(page, "Event Stream", `${DASHBOARD_PATH}events`);
  1641 |     await expect(
  1642 |       page.getByRole("heading", { name: "Event Stream" }),
  1643 |     ).toBeVisible();
  1644 |     await expect(
  1645 |       page.getByText("Dashboard API fixture ready", { exact: true }),
  1646 |     ).toBeVisible();
  1647 | 
  1648 |     await openNavigation(page, "AI Assistant", `${DASHBOARD_PATH}ai`);
  1649 |     await expect(page).not.toHaveURL(/sign-in/);
  1650 |     await expect(
  1651 |       page
  1652 |         .getByText(
  1653 |           /AI provider not configured|No AI key configured|AI Assistant/i,
  1654 |         )
  1655 |         .first(),
  1656 |     ).toBeVisible();
  1657 | 
  1658 |     await openNavigation(
  1659 |       page,
  1660 |       "Mission Control",
  1661 |       `${DASHBOARD_PATH}mission-control`,
  1662 |     );
  1663 |     await expect(
  1664 |       page.getByRole("heading", { name: "No durable runs in the ledger" }),
  1665 |     ).toBeVisible();
  1666 | 
  1667 |     await page.goto(`${DASHBOARD_PATH}flight-deck?executionId=${EXECUTION_ID}`);
  1668 |     await expect(page).toHaveURL(
  1669 |       new RegExp(
  1670 |         `${DASHBOARD_PATH.replaceAll("/", "\\/")}flight-deck\\?executionId=`,
  1671 |       ),
  1672 |     );
  1673 |     await expect(
  1674 |       page.getByRole("heading", { name: "Audit / Chat run" }),
  1675 |     ).toBeVisible();
  1676 |     await expect(
  1677 |       page.getByText("Controlled browser fixture completed.", { exact: true }),
  1678 |     ).toBeVisible();
  1679 |     await expect(
  1680 |       page.getByText("PROVEN", { exact: true }).first(),
  1681 |     ).toBeVisible();
  1682 |   });
  1683 | 
  1684 |   test("previews and downloads the completed execution audit without duplicating effects", async ({
  1685 |     page,
  1686 |   }) => {
  1687 |     const auditRequests: string[] = [];
  1688 |     const auditBody = {
  1689 |       format: "engineeringos.execution-audit.v1",
  1690 |       exportedAt: "2026-01-01T00:02:00.000Z",
  1691 |       execution: {
  1692 |         id: EXECUTION_ID,
  1693 |         projectId: "e2e-project",
  1694 |         sessionId: "e2e-audit-session",
  1695 |         operationId: executionFixture.operationId,
  1696 |         status: "completed",
  1697 |         terminalState: "completed",
  1698 |         revision: "e2e-revision-42",
  1699 |         proof: { required: false, verdict: "PROVEN" },
  1700 |       },
  1701 |       timeline: [],
  1702 |       validations: [{ status: "passed", profile: "release-safe" }],
  1703 |       affectedFiles: ["src/feature.ts"],
  1704 |       redaction: {
  1705 |         excluded: [
  1706 |           "provider secrets",
  1707 |           "raw model output",
  1708 |           "private runtime paths",
  1709 |         ],
  1710 |       },
  1711 |     };
  1712 |     await installApiFixtures(page, {
  1713 |       auditExport: {
  1714 |         body: auditBody,
  1715 |         filename: "server-supplied-audit-name.json",
  1716 |         requests: auditRequests,
  1717 |         failFirstPreview: true,
  1718 |       },
  1719 |     });
  1720 |     await programmaticSignIn(page);
  1721 |     await page.evaluate(() => {
  1722 |       const execution = {
  1723 |         id: "e2e-controlled-execution",
  1724 |         projectId: "e2e-project",
  1725 |         sessionId: "e2e-audit-session",
  1726 |         message: "Completed audit execution",
  1727 |       };
  1728 |       localStorage.setItem(
  1729 |         "eos_ai_execution_current_e2e-project",
  1730 |         "e2e-audit-session",
  1731 |       );
```