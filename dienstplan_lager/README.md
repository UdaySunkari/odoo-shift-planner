# Shift Planning Turbo

A modern weekly shift planner for Odoo Community 19.

Designed for warehouses, production lines, retail and hospitality teams that
need an at-a-glance overview of who works where, when — without the overhead
of a full WFM suite.

## Features

* **Week-grid SPA with drag & drop** – drag employees, drag area chips,
  reschedule shifts by dropping them on a new cell.
* **Live KPIs** – planned hours vs. target, occupancy rate, absences,
  conflict count.
* **Conflict detection** – overlapping shifts for the same employee on the
  same day are highlighted automatically.
* **Workflow** – shifts move between *Draft* and *Published*. The TV kiosk
  only displays *Published* shifts.
* **HR Holidays integration** – approved leaves automatically appear in the
  planner and on the kiosk display.
* **Copy Previous Week** wizard with optional "delete existing first" and
  "only published" filters.
* **TV / shop-floor kiosk page** with auto-refresh, **token-protected** to
  protect employee privacy.
* **Color-coded areas** – customize per role / zone (e.g. Picking, Packing,
  Reception, Off).
* **Translations** included for English (source) and German.

## Installation

1. Copy the `dienstplan_lager` folder into your Odoo addons path.
2. Update the apps list in Odoo (`Apps → Update Apps List`).
3. Install **Shift Planning Turbo** from the Apps screen.
4. Open the new top-level menu **Shift Planning**.

## Configuration

### Areas

Go to **Shift Planning → Configuration → Areas** to define the work zones /
roles your team uses. Each area has:

* a name (translatable),
* a short code shown on the kiosk and in the planner,
* a HEX color (validated, must be `#abc` or `#aabbcc` format),
* an "Is absence" flag (used for vacation / sick / off-duty area types).

### Default area per employee

On the employee form (HR app) there is a new **Shift Planning** tab where
you can set a *Default Shift Area*. New shifts created via the planner
will be pre-filled with that area.

### TV kiosk – security

The kiosk URL `/dienstplan/kiosk` is **disabled by default** and shows an
information page until an administrator configures an access token.

This is intentional: the kiosk runs without login so that it can be
displayed on a passive screen, and we do not want employee names exposed
on the public internet without protection.

To enable the kiosk:

1. Generate a strong random token, e.g.

   ```bash
   python -c "import secrets; print(secrets.token_urlsafe(32))"
   ```

2. Go to **Settings → Technical → Parameters → System Parameters** and
   create a new entry:

   * **Key**: `dienstplan_lager.kiosk_token`
   * **Value**: *the random token from step 1*

3. Open the kiosk on the TV / browser:

   ```
   https://your-odoo-host/dienstplan/kiosk?token=YOUR_TOKEN
   ```

The kiosk only displays:

* employee name,
* area code and time of *published* shifts,
* a generic "Absent" placeholder for approved leaves
  (the holiday type is **never** exposed on the kiosk).

## Privacy / GDPR notes

* No external CDN is used. Fonts come from the operating system's font
  stack. No request leaves the Odoo server when the planner is rendered.
* The kiosk hides the leave type/reason. Employees are listed by full
  name on the kiosk page, which is necessary for shift assignment.
  Restrict the kiosk URL to internal IPs / your local network where
  appropriate.
* All RPC error messages are sanitized — internal stack traces are
  logged server-side, never returned to the browser.

## Models

| Model                                | Description                       |
|--------------------------------------|-----------------------------------|
| `dienstplan.bereich`                 | Area / role definition            |
| `dienstplan.schicht`                 | Planned shift                     |
| `dienstplan.copy.previous.week`      | Wizard to copy a week             |
| `hr.employee` (extended)             | Default & allowed areas           |

## Routes

| Route                              | Auth   | Notes                       |
|------------------------------------|--------|-----------------------------|
| `/dienstplan/planung`              | user   | SPA shell                   |
| `/dienstplan/api/week`             | user   | JSON, week data             |
| `/dienstplan/api/shift/create`     | user   | JSON, create shift          |
| `/dienstplan/api/shift/update`     | user   | JSON, update shift          |
| `/dienstplan/api/shift/delete`     | user   | JSON, delete shift          |
| `/dienstplan/api/shift/publish`    | user   | JSON, publish/unpublish     |
| `/dienstplan/kiosk`                | public | Token-protected             |

## License

This module is released under the **LGPL-3** license. See `LICENSE`.

## Support

Issues and pull requests are welcome on the project's repository.

## Changelog

### 19.0.4.1.0
- **Fix:** Target hours in the Planned Hours card now only counts employees with activity in the visible period (was previously counting every active employee in the database).
- **Fix:** Target hours scale correctly across Day / Week / Month / Year views.
- **New:** Drag an employee from the sidebar onto the grid (any cell or the employee column) to add them as an empty row — no automatic shift is created.
- **New:** Hover an employee row → click the × button to remove them from the current view. Asks to confirm and deletes their shifts in the visible period, or just un-pins if they have none.
- **New:** Click the Planned Hours card → opens a workload breakdown with per-employee bars. Click a row to jump to that employee in the grid.
- **New:** Click the Absences card → opens a list of who's out, when, and for how long.
- **New:** Click the Conflicts card → opens a Schedule Health panel showing overlaps, overtime, empty rows, and draft shifts — each with quick-action buttons.
- **UI:** Visual drop-target highlight on the employee column matches the day-cell highlight.

### 19.0.4.1.2
- **Fix:** Overtime detection in Schedule Health now accounts for approved leave days — someone with 2 days off no longer triggers a false overtime warning if they're scheduled for their adjusted available capacity.
- **Fix:** "Delete duplicate" on overlapping shifts replaced with a side-by-side Resolve dialog that lets the planner pick which shift to delete. No more accidental data loss.
- **Test:** Added `test_clear_period.py` with 5 test cases covering the new bulk-clear endpoint (per-employee scope, period boundaries, week navigation, no-op when empty).

### 19.0.4.1.6
- **Security:** Removed `.sudo()` calls from the `/dienstplan/print` view. The print page was reading `dienstplan.schicht`, `hr.leave`, and `hr.employee` as the superuser, bypassing the multi-company record rule defined in `dienstplan_rules.xml`. On multi-company Odoo instances, a planner in one company would see other companies' shifts and leaves merged into the same print output. The print view now reads with the planner's own permissions, the same way `/dienstplan/api/week` already does.

### 19.0.4.1.5
- **Security:** The JSON endpoint `/dienstplan/api/settings/get` was reachable by any logged-in internal user (auth='user' with no group check) and returned the `kiosk_token` in its response. Since the kiosk URL is `auth='public'` and protected only by that token, any internal user could read the token and share the public roster URL externally. The endpoint now requires the `Shift Planner` group, matching `/api/settings/update`. Error messages in both endpoints are now translatable.

### 19.0.4.1.4
- **Fix:** The filter / group-by / favorites dropdown was hardcoded in German and bypassed the translation system. All strings (column headers, subtitles, items, footer keyboard hints, reset bar, empty-state hint, "New filter" modal, selected counter) now go through the `_translations()` payload and respect the user's language.
- **Fix:** Removed hardcoded `QCHEFS · Workforce Scheduler` footer brand. The footer brand is now a translatable string (`app_footer_brand`) defaulting to `Shift Planning · Workforce Scheduler`.
- **Fix:** Bumped asset cache-bust query strings so browsers reload the JS/CSS.

### 19.0.4.1.3
- **Fix:** Print page now forces A4 landscape orientation, so all 7 weekday columns (including Saturday and Sunday) fit on one page. Adds `<colgroup>` with fixed column widths and tighter padding/font sizes for print, plus repeating table headers across multi-page schedules.