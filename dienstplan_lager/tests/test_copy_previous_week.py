# -*- coding: utf-8 -*-
from datetime import datetime, date, timedelta
from odoo.exceptions import UserError
from odoo.tests.common import TransactionCase, tagged


@tagged('post_install', '-at_install')
class TestCopyPreviousWeek(TransactionCase):
    """Tests for the Copy Previous Week wizard."""

    def setUp(self):
        super().setUp()
        self.Schicht = self.env['dienstplan.schicht']
        self.Wizard = self.env['dienstplan.copy.previous.week']
        Bereich = self.env['dienstplan.bereich']
        Employee = self.env['hr.employee']

        self.bereich = Bereich.create({
            'name': 'A', 'code': 'A', 'html_color': '#111111'})
        self.employee = Employee.create({'name': 'W'})

        # Source week: Mon 2030-01-07
        self.source_monday = date(2030, 1, 7)
        # Target week: Mon 2030-01-14
        self.target_monday = date(2030, 1, 14)

        self.src_shift = self.Schicht.create({
            'employee_id': self.employee.id,
            'bereich_id': self.bereich.id,
            'datum_von': datetime(2030, 1, 7, 8, 0),
            'datum_bis': datetime(2030, 1, 7, 16, 0),
            'state': 'published',
        })
        self.src_draft = self.Schicht.create({
            'employee_id': self.employee.id,
            'bereich_id': self.bereich.id,
            'datum_von': datetime(2030, 1, 8, 8, 0),
            'datum_bis': datetime(2030, 1, 8, 16, 0),
            'state': 'draft',
        })

    def _shifts_in_week(self, monday):
        sunday = monday + timedelta(days=7)
        return self.Schicht.search([
            ('datum_von', '>=', datetime.combine(monday, datetime.min.time())),
            ('datum_von', '<', datetime.combine(sunday, datetime.min.time())),
        ])

    def test_basic_copy(self):
        wiz = self.Wizard.create({
            'quell_woche_start': self.source_monday,
            'ziel_woche_start': self.target_monday,
        })
        wiz.action_kopieren()
        copies = self._shifts_in_week(self.target_monday)
        self.assertEqual(len(copies), 2)
        # All copies must be drafts (original "published" is reset)
        self.assertEqual(set(copies.mapped('state')), {'draft'})

    def test_only_published_filter(self):
        wiz = self.Wizard.create({
            'quell_woche_start': self.source_monday,
            'ziel_woche_start': self.target_monday,
            'nur_veroeffentlichte': True,
        })
        wiz.action_kopieren()
        copies = self._shifts_in_week(self.target_monday)
        self.assertEqual(len(copies), 1)

    def test_delete_existing_first(self):
        # Pre-populate target week
        self.Schicht.create({
            'employee_id': self.employee.id,
            'bereich_id': self.bereich.id,
            'datum_von': datetime(2030, 1, 14, 8, 0),
            'datum_bis': datetime(2030, 1, 14, 16, 0),
        })
        self.assertEqual(len(self._shifts_in_week(self.target_monday)), 1)

        wiz = self.Wizard.create({
            'quell_woche_start': self.source_monday,
            'ziel_woche_start': self.target_monday,
            'bestehende_loeschen': True,
        })
        wiz.action_kopieren()
        copies = self._shifts_in_week(self.target_monday)
        # 2 sources copied, the prior 1 was wiped
        self.assertEqual(len(copies), 2)

    def test_same_source_and_target_rejected(self):
        wiz = self.Wizard.create({
            'quell_woche_start': self.source_monday,
            'ziel_woche_start': self.source_monday,
        })
        with self.assertRaises(UserError):
            wiz.action_kopieren()

    def test_empty_source_raises(self):
        empty_monday = date(2031, 1, 6)  # has no shifts
        wiz = self.Wizard.create({
            'quell_woche_start': empty_monday,
            'ziel_woche_start': self.target_monday,
        })
        with self.assertRaises(UserError):
            wiz.action_kopieren()

    def test_time_of_day_preserved(self):
        wiz = self.Wizard.create({
            'quell_woche_start': self.source_monday,
            'ziel_woche_start': self.target_monday,
        })
        wiz.action_kopieren()
        copies = self._shifts_in_week(self.target_monday).sorted('datum_von')
        # First copy should land on Mon 2030-01-14 08:00 (original was Mon 08:00)
        self.assertEqual(copies[0].datum_von, datetime(2030, 1, 14, 8, 0))
        # Second copy on Tue 2030-01-15 08:00
        self.assertEqual(copies[1].datum_von, datetime(2030, 1, 15, 8, 0))
