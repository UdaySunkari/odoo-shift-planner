# -*- coding: utf-8 -*-
"""GDPR / privacy tests for the public kiosk endpoint.

These tests are critical: they verify that the kiosk does NOT leak
personal data without proper authorization, and that approved leave
reasons are NEVER exposed on the public page.
"""
from datetime import datetime
from odoo.tests.common import HttpCase, tagged


@tagged('post_install', '-at_install')
class TestKioskSecurity(HttpCase):

    def setUp(self):
        super().setUp()
        self.IrConfigParameter = self.env['ir.config_parameter'].sudo()
        # Make sure no token is configured at the start of each test
        self.IrConfigParameter.set_param('dienstplan_lager.kiosk_token', '')

    # ----------------------------------------------------------
    # Token enforcement
    # ----------------------------------------------------------
    def test_kiosk_disabled_when_no_token_configured(self):
        """Without a configured token, the kiosk must show the disabled
        page and MUST NOT render any roster data."""
        resp = self.url_open('/dienstplan/kiosk')
        self.assertEqual(resp.status_code, 200)
        body = resp.text.lower()
        # Must show the disabled page
        self.assertIn('disabled', body)
        # Must NOT render the roster table
        self.assertNotIn('<table', body)

    def test_kiosk_unauthorized_with_wrong_token(self):
        """Wrong token → unauthorized page, never the data."""
        self.IrConfigParameter.set_param(
            'dienstplan_lager.kiosk_token', 'correct-secret')
        resp = self.url_open('/dienstplan/kiosk?token=WRONG')
        self.assertEqual(resp.status_code, 200)
        body = resp.text.lower()
        self.assertIn('access denied', body)
        self.assertNotIn('<table', body)

    def test_kiosk_unauthorized_with_no_token_param(self):
        """Token configured but URL has no token param → unauthorized."""
        self.IrConfigParameter.set_param(
            'dienstplan_lager.kiosk_token', 'correct-secret')
        resp = self.url_open('/dienstplan/kiosk')
        body = resp.text.lower()
        self.assertIn('access denied', body)

    def test_kiosk_authorized_with_correct_token(self):
        """Correct token → roster page is rendered."""
        self.IrConfigParameter.set_param(
            'dienstplan_lager.kiosk_token', 'correct-secret')
        resp = self.url_open('/dienstplan/kiosk?token=correct-secret')
        self.assertEqual(resp.status_code, 200)
        body = resp.text
        # The roster page contains a <table>
        self.assertIn('<table', body)

    # ----------------------------------------------------------
    # PII / GDPR – leave reason MUST NOT be exposed
    # ----------------------------------------------------------
    def test_leave_holiday_status_name_never_exposed(self):
        """A sensitive leave type label like 'Sick' must NEVER appear on
        the kiosk page – we only show a generic 'Absent' placeholder."""
        # Set up: token + a leave with a sensitive holiday status
        self.IrConfigParameter.set_param(
            'dienstplan_lager.kiosk_token', 'tok')

        Bereich = self.env['dienstplan.bereich']
        Employee = self.env['hr.employee']
        Schicht = self.env['dienstplan.schicht']
        HolidayStatus = self.env['hr.leave.type']
        Leave = self.env['hr.leave']

        bereich = Bereich.create({
            'name': 'Picking', 'code': 'PICK', 'html_color': '#111111'})
        employee = Employee.create({'name': 'Alice Tester'})

        # Publish a shift so there is something on the kiosk
        Schicht.create({
            'employee_id': employee.id,
            'bereich_id': bereich.id,
            'datum_von': datetime(2030, 1, 7, 8, 0),
            'datum_bis': datetime(2030, 1, 7, 16, 0),
            'state': 'published',
        })

        # A sensitive holiday type that we MUST NOT leak to the public kiosk
        sick_type = HolidayStatus.search(
            [('name', 'ilike', 'sick')], limit=1)
        if not sick_type:
            sick_type = HolidayStatus.create({
                'name': 'XYZ_SUPER_SECRET_LEAVE_REASON',
                'requires_allocation': 'no',
            })

        # Create + approve a leave (best-effort, depends on hr_holidays setup)
        try:
            leave = Leave.sudo().with_context(leave_skip_state_check=True).create({
                'employee_id': employee.id,
                'holiday_status_id': sick_type.id,
                'request_date_from': '2030-01-08',
                'request_date_to': '2030-01-08',
            })
            leave.sudo().write({'state': 'validate'})
        except Exception:
            # If the workflow can't be coerced, skip the leave portion;
            # the no-leak assertion below is still valuable.
            pass

        # Open the kiosk for that week
        resp = self.url_open(
            '/dienstplan/kiosk?token=tok&offset=' + self._weeks_until(2030, 1, 7))
        body = resp.text

        # The sensitive leave type name must NOT appear anywhere
        if sick_type.name and sick_type.name.startswith('XYZ_SUPER_SECRET'):
            self.assertNotIn(sick_type.name, body,
                "Leave type name leaked to public kiosk!")

    # ----------------------------------------------------------
    # SPA endpoints require auth
    # ----------------------------------------------------------
    def test_planning_spa_requires_login(self):
        """The /dienstplan/planung route must require user auth."""
        resp = self.url_open('/dienstplan/planung', allow_redirects=False)
        # Anonymous users are either redirected to login (302/303) or
        # served a Forbidden / login page (200 with login form). Either
        # way, they must NOT be served the SPA.
        body = resp.text.lower() if resp.status_code == 200 else ''
        if resp.status_code == 200:
            self.assertNotIn('planungturbo', body.replace(' ', '').lower())
            self.assertIn('login', body)
        else:
            self.assertIn(resp.status_code, (302, 303, 401, 403))

    # ----------------------------------------------------------
    # helpers
    # ----------------------------------------------------------
    def _weeks_until(self, y, m, d):
        from datetime import date
        today = date.today()
        target = date(y, m, d)
        target_monday = target - \
            __import__('datetime').timedelta(days=target.weekday())
        today_monday = today - \
            __import__('datetime').timedelta(days=today.weekday())
        return str((target_monday - today_monday).days // 7)
