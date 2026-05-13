# -*- coding: utf-8 -*-
from datetime import datetime, timedelta
from odoo.exceptions import ValidationError
from odoo.tests.common import TransactionCase, tagged


@tagged('post_install', '-at_install')
class TestDienstplanSchicht(TransactionCase):
    """Tests for the Shift model: date constraints, computed fields,
    workflow transitions."""

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
        self.bereich_off = self.Bereich.create({
            'name': 'Vacation',
            'code': 'VAC',
            'html_color': '#999999',
            'ist_abwesenheit': True,
        })
        self.employee = self.Employee.create({'name': 'Test Worker'})

        # Anchor in 2030 so we don't depend on the current calendar
        self.start = datetime(2030, 1, 7, 8, 0)   # Monday
        self.end = datetime(2030, 1, 7, 16, 30)

    # ---------- Constraints ----------
    def test_end_must_be_after_start(self):
        with self.assertRaises(ValidationError):
            self.Schicht.create({
                'employee_id': self.employee.id,
                'bereich_id': self.bereich.id,
                'datum_von': self.end,
                'datum_bis': self.start,  # swapped
            })

    def test_equal_start_end_rejected(self):
        with self.assertRaises(ValidationError):
            self.Schicht.create({
                'employee_id': self.employee.id,
                'bereich_id': self.bereich.id,
                'datum_von': self.start,
                'datum_bis': self.start,
            })

    # ---------- Computed / related ----------
    def test_display_name_combines_employee_and_area(self):
        s = self.Schicht.create({
            'employee_id': self.employee.id,
            'bereich_id': self.bereich.id,
            'datum_von': self.start,
            'datum_bis': self.end,
        })
        self.assertIn('Test Worker', s.display_name)
        self.assertIn('Test Area', s.display_name)

    def test_ist_abwesenheit_inherited_from_bereich(self):
        s = self.Schicht.create({
            'employee_id': self.employee.id,
            'bereich_id': self.bereich_off.id,
            'datum_von': self.start,
            'datum_bis': self.end,
        })
        self.assertTrue(s.ist_abwesenheit)

        s_normal = self.Schicht.create({
            'employee_id': self.employee.id,
            'bereich_id': self.bereich.id,
            'datum_von': self.start,
            'datum_bis': self.end,
        })
        self.assertFalse(s_normal.ist_abwesenheit)

    def test_html_color_relation(self):
        s = self.Schicht.create({
            'employee_id': self.employee.id,
            'bereich_id': self.bereich.id,
            'datum_von': self.start,
            'datum_bis': self.end,
        })
        self.assertEqual(s.html_color, '#123456')

    # ---------- Workflow ----------
    def test_default_state_is_draft(self):
        s = self.Schicht.create({
            'employee_id': self.employee.id,
            'bereich_id': self.bereich.id,
            'datum_von': self.start,
            'datum_bis': self.end,
        })
        self.assertEqual(s.state, 'draft')

    def test_publish_flow(self):
        s = self.Schicht.create({
            'employee_id': self.employee.id,
            'bereich_id': self.bereich.id,
            'datum_von': self.start,
            'datum_bis': self.end,
        })
        s.action_publish()
        self.assertEqual(s.state, 'published')
        s.action_draft()
        self.assertEqual(s.state, 'draft')
