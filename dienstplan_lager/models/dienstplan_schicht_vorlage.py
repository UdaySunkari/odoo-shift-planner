# -*- coding: utf-8 -*-
from odoo import _, api, fields, models
from odoo.exceptions import ValidationError

from .utils import HEX_COLOR_RE


class DienstplanSchichtVorlage(models.Model):
    """Reusable shift template — drag a template onto a planner cell to
    instantly create a shift with predefined times and (optionally) area.

    Typical examples:
      * 'Early shift'   — 06:00 to 14:00, area: any
      * 'Late shift'    — 14:00 to 22:00, area: any
      * 'Sat. peak'     — 10:00 to 18:00, area: PICK-B2C only
    """
    _name = 'dienstplan.schicht.vorlage'
    _description = 'Shift Template'
    _order = 'sequence, name'

    name = fields.Char(
        string='Name',
        required=True,
        translate=True,
        help='Human-readable name shown on the chip in the planner sidebar.',
    )
    bereich_id = fields.Many2one(
        'dienstplan.bereich',
        string='Area',
        ondelete='set null',
        help='If set, dragging this template onto a cell creates a shift '
             'in this area. If left empty, the employee\'s default area '
             '(or the first available area) is used.',
    )
    start_hour = fields.Integer(
        string='Start hour',
        default=8,
        help='0–23. Hour-of-day when the shift starts.',
    )
    start_minute = fields.Integer(
        string='Start minute',
        default=0,
        help='0, 15, 30 or 45 minutes past the start hour.',
    )
    end_hour = fields.Integer(
        string='End hour',
        default=16,
        help='0–23. Hour-of-day when the shift ends.',
    )
    end_minute = fields.Integer(
        string='End minute',
        default=30,
    )
    sequence = fields.Integer(string='Sequence', default=10)
    html_color = fields.Char(
        string='HTML Color',
        help='Optional. Falls back to the area color if blank.',
    )
    active = fields.Boolean(default=True)
    notiz = fields.Text(
        string='Description',
        help='Internal notes about when / how to use this template.',
    )
    company_id = fields.Many2one(
        'res.company',
        string='Company',
        default=lambda self: self.env.company,
        help='Leave empty to share this template across all companies.',
    )

    duration_hours = fields.Float(
        string='Duration',
        compute='_compute_duration_hours',
        help='Computed shift length in hours, for display purposes.',
    )

    @api.depends('start_hour', 'start_minute', 'end_hour', 'end_minute')
    def _compute_duration_hours(self):
        for rec in self:
            start = rec.start_hour + (rec.start_minute or 0) / 60.0
            end = rec.end_hour + (rec.end_minute or 0) / 60.0
            if end <= start:
                # overnight shift — wrap around 24h
                end += 24
            rec.duration_hours = end - start

    @api.constrains('start_hour', 'start_minute', 'end_hour', 'end_minute')
    def _check_times(self):
        for rec in self:
            if not (0 <= rec.start_hour <= 23):
                raise ValidationError(_('Start hour must be between 0 and 23.'))
            if not (0 <= rec.end_hour <= 23):
                raise ValidationError(_('End hour must be between 0 and 23.'))
            if rec.start_minute not in (0, 15, 30, 45):
                raise ValidationError(_('Start minute must be 0, 15, 30 or 45.'))
            if rec.end_minute not in (0, 15, 30, 45):
                raise ValidationError(_('End minute must be 0, 15, 30 or 45.'))

    @api.constrains('html_color')
    def _check_html_color(self):
        for rec in self:
            if rec.html_color and not HEX_COLOR_RE.match(rec.html_color):
                raise ValidationError(_(
                    'HTML Color must be a valid hex code, e.g. #3498db '
                    'or #abc.'
                ))
