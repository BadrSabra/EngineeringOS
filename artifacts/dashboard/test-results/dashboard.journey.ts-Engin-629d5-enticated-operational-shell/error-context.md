# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: dashboard.journey.ts >> EngineeringOS dashboard browser journey >> signs in and traverses the authenticated operational shell
- Location: e2e/dashboard.journey.ts:1494:3

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
  - text: Updated 10:35:35 PM
  - button "Refresh status"
  - text: SYSTEM ONLINE
  - region "AI diagnostics retention health":
    - heading "AI diagnostics retention" [level=2]
    - text: Healthy
    - paragraph: Last completed 8/23/2026, 10:35:15 PM
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
  1418 |         status: execution.status,
  1419 |         flightState: execution.flightState,
  1420 |       },
  1421 |       messages: messages.map(
  1422 |         ({
  1423 |           id,
  1424 |           sessionId: messageSession,
  1425 |           role,
  1426 |           executionId: messageExecution,
  1427 |           outcome,
  1428 |         }) => ({
  1429 |           id,
  1430 |           sessionId: messageSession,
  1431 |           role,
  1432 |           executionId: messageExecution,
  1433 |           outcome,
  1434 |         }),
  1435 |       ),
  1436 |       sseEvents: sseEvents.map(
  1437 |         ({
  1438 |           type,
  1439 |           executionId: eventExecution,
  1440 |           sessionId: eventSession,
  1441 |           outcome,
  1442 |           code,
  1443 |         }) => ({
  1444 |           type,
  1445 |           executionId: eventExecution,
  1446 |           sessionId: eventSession,
  1447 |           outcome,
  1448 |           code,
  1449 |         }),
  1450 |       ),
  1451 |       checkpoints: [
  1452 |         {
  1453 |           sequence: checkpoint.sequence,
  1454 |           stage: checkpoint.stage,
  1455 |           updatedAt: checkpoint.updatedAt,
  1456 |         },
  1457 |       ],
  1458 |       evidenceCount,
  1459 |       proposals: proposal
  1460 |         ? [
  1461 |             {
  1462 |               id: proposal.id,
  1463 |               revision: proposal.revision,
  1464 |               status: proposal.status,
  1465 |             },
  1466 |           ]
  1467 |         : [],
  1468 |       validation: validation.map((step) => ({
  1469 |         status: step.validation?.status ?? step.status,
  1470 |         profile: step.validation?.profile ?? step.validationProfile,
  1471 |       })),
  1472 |       events: events.map(({ type, severity, correlationId }) => ({
  1473 |         type,
  1474 |         severity,
  1475 |         correlationId,
  1476 |       })),
  1477 |       dashboard: missionControl,
  1478 |       dashboardState: {
  1479 |         projectCount: dashboardState.projectCount,
  1480 |         activeTaskCount: dashboardState.activeTaskCount,
  1481 |       },
  1482 |     };
  1483 |     const outputPath =
  1484 |       process.env.DASHBOARD_E2E_LIVE_REPORT_PATH ??
  1485 |       "test-results/dashboard-journey/live-mission-correlation.json";
  1486 |     await mkdir(dirname(outputPath), { recursive: true });
  1487 |     await writeFile(
  1488 |       outputPath,
  1489 |       `${JSON.stringify(capture, null, 2)}\n`,
  1490 |       "utf8",
  1491 |     );
  1492 |   });
  1493 | 
  1494 |   test("signs in and traverses the authenticated operational shell", async ({
  1495 |     page,
  1496 |   }) => {
  1497 |     await installApiFixtures(page);
  1498 |     await programmaticSignIn(page);
  1499 |     for (const origin of approvedDashboardOrigins()) {
  1500 |       await expectOriginCanUseApi(page, origin);
  1501 |     }
  1502 |     await expectHostileOriginRejected(page);
  1503 | 
  1504 |     await expect(
  1505 |       page.getByRole("heading", { name: "System Overview" }),
  1506 |     ).toBeVisible();
  1507 |     await expect(
  1508 |       page.getByText("SYSTEM ONLINE", { exact: true }),
  1509 |     ).toBeVisible();
  1510 |     await expect(
  1511 |       page.getByText("Smoke Project", { exact: true }).first(),
  1512 |     ).toBeVisible();
  1513 |     await expect(
  1514 |       page.getByText("Dashboard API fixture ready", { exact: true }),
  1515 |     ).toBeVisible();
  1516 |     await expect(
  1517 |       page.getByText("Showing 1–1 of 1", { exact: true }),
> 1518 |     ).toBeVisible();
       |       ^ Error: expect(locator).toBeVisible() failed
  1519 |     await expect(page.getByRole("button", { name: "Older" })).toBeDisabled();
  1520 | 
  1521 |     await openNavigation(page, "Projects", `${DASHBOARD_PATH}projects`);
  1522 |     await expect(page.getByRole("heading", { name: "Projects" })).toBeVisible();
  1523 |     await expect(
  1524 |       page.getByText("Smoke Project", { exact: true }),
  1525 |     ).toBeVisible();
  1526 | 
  1527 |     await openNavigation(page, "Event Stream", `${DASHBOARD_PATH}events`);
  1528 |     await expect(
  1529 |       page.getByRole("heading", { name: "Event Stream" }),
  1530 |     ).toBeVisible();
  1531 |     await expect(
  1532 |       page.getByText("Dashboard API fixture ready", { exact: true }),
  1533 |     ).toBeVisible();
  1534 | 
  1535 |     await openNavigation(page, "AI Assistant", `${DASHBOARD_PATH}ai`);
  1536 |     await expect(page).not.toHaveURL(/sign-in/);
  1537 |     await expect(
  1538 |       page
  1539 |         .getByText(
  1540 |           /AI provider not configured|No AI key configured|AI Assistant/i,
  1541 |         )
  1542 |         .first(),
  1543 |     ).toBeVisible();
  1544 | 
  1545 |     await openNavigation(
  1546 |       page,
  1547 |       "Mission Control",
  1548 |       `${DASHBOARD_PATH}mission-control`,
  1549 |     );
  1550 |     await expect(
  1551 |       page.getByRole("heading", { name: "No durable runs in the ledger" }),
  1552 |     ).toBeVisible();
  1553 | 
  1554 |     await page.goto(`${DASHBOARD_PATH}flight-deck?executionId=${EXECUTION_ID}`);
  1555 |     await expect(page).toHaveURL(
  1556 |       new RegExp(
  1557 |         `${DASHBOARD_PATH.replaceAll("/", "\\/")}flight-deck\\?executionId=`,
  1558 |       ),
  1559 |     );
  1560 |     await expect(
  1561 |       page.getByRole("heading", { name: "Audit / Chat run" }),
  1562 |     ).toBeVisible();
  1563 |     await expect(
  1564 |       page.getByText("Controlled browser fixture completed.", { exact: true }),
  1565 |     ).toBeVisible();
  1566 |     await expect(
  1567 |       page.getByText("PROVEN", { exact: true }).first(),
  1568 |     ).toBeVisible();
  1569 |   });
  1570 | 
  1571 |   test("uploads an archive and renders a live task update", async ({
  1572 |     page,
  1573 |   }) => {
  1574 |     const taskId = "e2e-live-task";
  1575 |     const liveLog = {
  1576 |       id: "e2e-live-log",
  1577 |       taskId,
  1578 |       level: "info",
  1579 |       message: "Live update received from the server",
  1580 |       timestamp: "2026-01-01T00:00:02.000Z",
  1581 |     };
  1582 |     await installApiFixtures(page, {
  1583 |       archiveUpload: {
  1584 |         uploadId: "e2e-upload",
  1585 |         originalName: "dashboard-journey.zip",
  1586 |       },
  1587 |       liveTask: {
  1588 |         id: taskId,
  1589 |         title: "Verify live dashboard updates",
  1590 |         projectId: "e2e-project",
  1591 |         log: liveLog,
  1592 |       },
  1593 |     });
  1594 |     await programmaticSignIn(page);
  1595 | 
  1596 |     // This is a valid, empty ZIP archive. Keeping it inline makes the browser
  1597 |     // test self-contained while still exercising FormData and multipart bytes.
  1598 |     const uploadResult = await page.evaluate(async (apiBaseUrl) => {
  1599 |       const bytes = Uint8Array.from(
  1600 |         atob("UEsFBgAAAAAAAAAAAAAAAAAAAAAAAA=="),
  1601 |         (character) => character.charCodeAt(0),
  1602 |       );
  1603 |       const body = new FormData();
  1604 |       body.append(
  1605 |         "archive",
  1606 |         new Blob([bytes], { type: "application/zip" }),
  1607 |         "dashboard-journey.zip",
  1608 |       );
  1609 |       const response = await fetch(
  1610 |         new URL("/api/upload/archive", apiBaseUrl).toString(),
  1611 |         { method: "POST", credentials: "include", body },
  1612 |       );
  1613 |       return {
  1614 |         status: response.status,
  1615 |         body: (await response.json()) as Record<string, unknown>,
  1616 |       };
  1617 |     }, process.env.DASHBOARD_E2E_API_BASE_URL ?? page.url());
  1618 |     expect(uploadResult.status).toBe(201);
```