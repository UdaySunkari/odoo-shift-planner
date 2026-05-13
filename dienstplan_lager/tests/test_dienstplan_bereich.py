# -*- coding: utf-8 -*-
from odoo.exceptions import ValidationError
from odoo.tests.common import TransactionCase, tagged


@tagged('post_install', '-at_install')
class TestDienstplanBereich(TransactionCase):
    """Tests for the area model, primarily the hex-color validator that
    defends against CSS / style injection in the kiosk template."""

    def setUp(self):
        super().setUp()
        self.Bereich = self.env['dienstplan.bereich']

    def test_create_with_valid_six_digit_hex(self):
        b = self.Bereich.create({'name': 'Test', 'html_color': '#3498db'})
        self.assertEqual(b.html_color, '#3498db')

    def test_create_with_valid_three_digit_hex(self):
        b = self.Bereich.create({'name': 'Test', 'html_color': '#abc'})
        self.assertEqual(b.html_color, '#abc')

    def test_create_with_uppercase_hex(self):
        b = self.Bereich.create({'name': 'Test', 'html_color': '#ABCDEF'})
        self.assertEqual(b.html_color, '#ABCDEF')

    def test_reject_missing_hash(self):
        with self.assertRaises(ValidationError):
            self.Bereich.create({'name': 'Test', 'html_color': '3498db'})

    def test_reject_named_color(self):
        with self.assertRaises(ValidationError):
            self.Bereich.create({'name': 'Test', 'html_color': 'red'})

    def test_reject_css_injection(self):
        """Make sure attacker-controlled CSS cannot escape the style attribute."""
        for payload in [
            '#fff; }; <script>alert(1)</script>',
            '#fff"); background:url(',
            '#fff; background-image: url(evil)',
            'red; -moz-binding:url(',
            '#1234567',  # 7 hex chars — invalid
            '#12',       # 2 hex chars — invalid
            '#xyz',      # not hex
            '',          # empty
        ]:
            with self.subTest(payload=payload):
                with self.assertRaises(ValidationError,
                                       msg=f"Should reject: {payload!r}"):
                    self.Bereich.create({'name': 'X', 'html_color': payload})

    def test_default_color_is_valid(self):
        b = self.Bereich.create({'name': 'Test'})
        # Default is '#3498db' which must pass validation
        self.assertTrue(b.html_color.startswith('#'))

    def test_active_archives(self):
        b = self.Bereich.create({'name': 'Tmp'})
        b.active = False
        self.assertFalse(b.active)

    def test_demo_data_loaded(self):
        """The shipped demo areas exist after install."""
        komm_b2c = self.env.ref('dienstplan_lager.bereich_komm_b2c',
                                raise_if_not_found=False)
        self.assertIsNotNone(komm_b2c, "Demo data area 'Picking B2C' should exist")
