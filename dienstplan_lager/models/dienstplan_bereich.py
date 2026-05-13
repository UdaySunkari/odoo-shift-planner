# -*- coding: utf-8 -*-
from odoo import _, api, fields, models
from odoo.exceptions import ValidationError

from .utils import HEX_COLOR_RE


class DienstplanBereich(models.Model):
    _name = 'dienstplan.bereich'
    _description = 'Shift Planning Area / Role'
    _order = 'sequence, name'

    name = fields.Char(
        string='Name',
        required=True,
        translate=True,
    )
    code = fields.Char(
        string='Short Code',
        help='Short abbreviation for the kiosk display (e.g. K-B2C).',
    )
    sequence = fields.Integer(string='Sequence', default=10)
    color = fields.Integer(
        string='Color Index',
        default=0,
        help='Odoo internal color index (0-11) for kanban / calendar.',
    )
    html_color = fields.Char(
        string='HTML Color',
        default='#3498db',
        help='Background color for the kiosk display in HEX format, '
             'e.g. #3498db. Three- or six-digit hex codes are accepted.',
    )
    active = fields.Boolean(default=True)
    ist_abwesenheit = fields.Boolean(
        string='Is Absence',
        help='Mark this area as an absence type (vacation / sick).',
    )
    notiz = fields.Text(string='Description')
    company_id = fields.Many2one(
        'res.company',
        string='Company',
        default=lambda self: self.env.company,
        help='Leave empty to share this area across all companies.',
    )

    @api.constrains('html_color')
    def _check_html_color(self):
        """Strict hex validation – defends against CSS / style injection
        in templates that embed this value as inline style."""
        for rec in self:
            if rec.html_color and not HEX_COLOR_RE.match(rec.html_color):
                raise ValidationError(_(
                    'HTML Color must be a valid hex code, e.g. #3498db '
                    'or #abc.'
                ))
