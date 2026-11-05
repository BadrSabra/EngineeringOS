# Dashboard accessibility manual checklist

Automated axe checks run in JSDOM for the Shell navigation, the Projects list
and goal-creation dialog, the Tasks list and task-creation dialog, and the
Metrics no-project state. They assert that those rendered states have no axe
violations.

## Findings resolved by the automated checks

- The first Tasks list scan reported axe `nested-interactive`: the task-row
  toggle was a `div` with `role="button"` and contained action buttons for
  execute/retry/edit/delete. The row toggle is now a native button limited to
  the task summary, with its action buttons as siblings. The test now requires
  zero violations in both the list and creation dialog. No known axe exceptions
  are currently allowed in the covered states.

The tests disable axe's `color-contrast` rule because JSDOM does not render
colors the way a browser does. Passing these checks does **not** verify visual
contrast, keyboard usability in a real browser, or the experience with a screen
reader. Perform and record these checks separately before release:

- [ ] Check text, icons, focus indicators, borders, disabled controls, and
  status/error colors against WCAG contrast requirements in light and dark
  themes.
- [ ] Navigate the Shell, project list and goal dialog, and task list and
  creation dialog using only a keyboard; confirm visible focus and sensible
  focus entry, containment, close, and return behavior for dialogs/drawers.
- [ ] With a screen reader, confirm page/region headings, navigation labels,
  current-page indication, form labels, required fields, and error/status
  announcements.
- [ ] Check zoom/reflow and small viewport layouts without clipped content or
  obscured controls.

Record browser, assistive technology, theme, viewport, and any findings here
when completing the manual review. Do not treat JSDOM axe results as evidence
that these visual and assistive-technology checks passed.
