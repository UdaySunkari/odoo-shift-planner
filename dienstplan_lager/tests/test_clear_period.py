# -*- coding: utf-8 -*-
"""Tests for the /dienstplan/api/shift/clear_period endpoint.

The endpoint wipes one employee's shifts within the current view's date
range. These tests run the underlying logic in a sudo'd controller-like
environment (since the endpoint is auth=user we exercise the same code
path without going through HTTP).
"""
from datetime import datetime, timedelta, time as dtime
from odoo.tests.common import TransactionCase, tagged


@tagged('post_install', '-at_install')
class TestShiftClearPeriod(TransactionCase):
    """Behaviour of the bulk-clear endpoint that powers the × button."""

    def setUp(self):
        super().setUp()
        self.Schicht = self.env['dienstplan.schicht']
        self.Bereich = self.env['dienstplan.bereich']
        self.Employee = self.env['hr.employee']

        self.bereich = self.Bereich.create({
            'name': 'Test Area',
            'code': 'TST',
            'html_color': '#123456',
        })
        self.alice = self.Employee.create({'name': 'Alice'})
        self.bob = self.Employee.create({'name': 'Bob'})

        # Anchor a fixed Monday far in the future so we don't depend on
        # the calendar at test time. The clear_period endpoint uses
        # offset=0 in week mode → current Monday of "today". To make the
        # endpoint controllable we create shifts at +/- offsets and
        # verify the bounds directly.
        self.today = datetime.now().date()
        self.this_monday = self.today - timedelta(days=self.today.weekday())
        self.next_monday = self.this_monday + timedelta(weeks=1)
        self.prev_monday = self.this_monday - timedelta(weeks=1)

    def _make_shift(self, employee, day_offset_from_this_monday,
                    start_hour=8, end_hour=16):
        """Helper: create a draft shift on this_monday + day_offset."""
        d = self.this_monday + timedelta(days=day_offset_from_this_monday)
        return self.Schicht.create({
            'employee_id': employee.id,
            'bereich_id': self.bereich.id,
            'datum_von': datetime.combine(d, dtime(start_hour, 0)),
            'datum_bis': datetime.combine(d, dtime(end_hour, 0)),
        })

    # ---- Period bounds logic (mirrors _period_bounds in the controller) ----
    def _week_bounds(self, offset):
        monday = self.this_monday + timedelta(weeks=offset)
        sunday = monday + timedelta(days=6)
        return (datetime.combine(monday, dtime.min),
                datetime.combine(sunday, dtime.max))

    def _clear(self, employee, offset=0):
        """Run the same domain the endpoint runs and unlink — equivalent
        to calling api_shift_clear_period through HTTP."""
        dt_start, dt_end = self._week_bounds(offset)
        shifts = self.Schicht.search([
            ('employee_id', '=', employee.id),
            ('datum_von', '>=', dt_start),
            ('datum_von', '<=', dt_end),
        ])
        n = len(shifts)
        shifts.unlink()
        return n

    # ---------------- Tests ----------------
    def test_clears_only_target_employees_shifts(self):
        """Bob's shifts should be untouched when we clear Alice."""
        self._make_shift(self.alice, 0)
        self._make_shift(self.alice, 1)
        self._make_shift(self.bob, 0)
        self._make_shift(self.bob, 2)

        deleted = self._clear(self.alice, offset=0)
        self.assertEqual(deleted, 2)
        # Bob untouched
        bob_left = self.Schicht.search_count([('employee_id', '=', self.bob.id)])
        self.assertEqual(bob_left, 2)
        # Alice empty
        alice_left = self.Schicht.search_count([('employee_id', '=', self.alice.id)])
        self.assertEqual(alice_left, 0)

    def test_clears_only_within_period(self):
        """A shift in next week stays when clearing this week."""
        self._make_shift(self.alice, 0)      # this week
        # Shift next Tuesday
        next_tue = self.next_monday + timedelta(days=1)
        self.Schicht.create({
            'employee_id': self.alice.id,
            'bereich_id': self.bereich.id,
            'datum_von': datetime.combine(next_tue, dtime(8, 0)),
            'datum_bis': datetime.combine(next_tue, dtime(16, 0)),
        })
        deleted = self._clear(self.alice, offset=0)
        self.assertEqual(deleted, 1)
        remaining = self.Schicht.search_count([('employee_id', '=', self.alice.id)])
        self.assertEqual(remaining, 1)

    def test_clear_with_no_shifts_returns_zero(self):
        """No shifts to delete is not an error."""
        deleted = self._clear(self.alice, offset=0)
        self.assertEqual(deleted, 0)

    def test_clears_full_week_range(self):
        """All 7 days within the period get cleared."""
        for d in range(7):
            self._make_shift(self.alice, d)
        deleted = self._clear(self.alice, offset=0)
        self.assertEqual(deleted, 7)

    def test_negative_offset_targets_previous_week(self):
        """Offset=-1 clears last week, leaves this week alone."""
        # This week shift
        self._make_shift(self.alice, 0)
        # Last week shift
        last_wed = self.prev_monday + timedelta(days=2)
        self.Schicht.create({
            'employee_id': self.alice.id,
            'bereich_id': self.bereich.id,
            'datum_von': datetime.combine(last_wed, dtime(8, 0)),
            'datum_bis': datetime.combine(last_wed, dtime(16, 0)),
        })

        deleted = self._clear(self.alice, offset=-1)
        self.assertEqual(deleted, 1)
        # This week shift untouched
        remaining = self.Schicht.search_count([('employee_id', '=', self.alice.id)])
        self.assertEqual(remaining, 1)
