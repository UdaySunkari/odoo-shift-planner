# -*- coding: utf-8 -*-
from odoo import _, fields, models


class HrEmployee(models.Model):
    _inherit = 'hr.employee'

    standard_bereich_id = fields.Many2one(
        'dienstplan.bereich',
        string='Default Shift Area',
        help='Pre-filled when creating new shifts for this employee.',
    )
    bereich_ids = fields.Many2many(
        'dienstplan.bereich',
        'hr_employee_dienstplan_bereich_rel',
        'employee_id',
        'bereich_id',
        string='Allowed Areas',
        help='Areas where this employee can be scheduled.',
    )
    weekly_hours_target = fields.Float(
        string='Weekly hours target',
        default=40.0,
        help='Target number of hours per week. Used by the planner '
             'to compute the workload bar — full-time = 40, part-time '
             'might be 20, mini-job = 10, etc.',
    )
