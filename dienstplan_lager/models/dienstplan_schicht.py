# -*- coding: utf-8 -*-
from datetime import timedelta
from odoo import _, api, fields, models
from odoo.exceptions import ValidationError


class DienstplanSchicht(models.Model):
    _name = 'dienstplan.schicht'
    _description = 'Planned Shift'
    _order = 'datum_von desc'
    _inherit = ['mail.thread', 'mail.activity.mixin']
    _rec_name = 'display_name'

    display_name = fields.Char(
        compute='_compute_display_name',
        store=True,
    )
    employee_id = fields.Many2one(
        'hr.employee',
        string='Employee',
        required=True,
        ondelete='cascade',
        tracking=True,
    )
    bereich_id = fields.Many2one(
        'dienstplan.bereich',
        string='Area',
        required=True,
        tracking=True,
    )
    datum_von = fields.Datetime(
        string='Start',
        required=True,
        default=fields.Datetime.now,
        tracking=True,
    )
    datum_bis = fields.Datetime(
        string='End',
        required=True,
        tracking=True,
    )
    notiz = fields.Text(string='Note')
    state = fields.Selection(
        selection=[
            ('draft', 'Draft'),
            ('published', 'Published'),
        ],
        default='draft',
        string='Status',
        tracking=True,
        required=True,
    )
    color = fields.Integer(
        related='bereich_id.color',
        store=True,
        string='Color',
    )
    html_color = fields.Char(related='bereich_id.html_color', store=True)
    ist_abwesenheit = fields.Boolean(
        related='bereich_id.ist_abwesenheit',
        store=True,
    )
    company_id = fields.Many2one(
        'res.company',
        string='Company',
        default=lambda self: self.env.company,
    )

    @api.depends('employee_id', 'bereich_id', 'datum_von')
    def _compute_display_name(self):
        for rec in self:
            emp = rec.employee_id.name or _('?')
            ber = rec.bereich_id.name or _('?')
            rec.display_name = f"{emp} · {ber}"

    @api.constrains('datum_von', 'datum_bis')
    def _check_dates(self):
        for rec in self:
            if rec.datum_bis and rec.datum_von and rec.datum_bis <= rec.datum_von:
                raise ValidationError(_('Shift end must be after shift start.'))

    @api.onchange('employee_id')
    def _onchange_employee_id(self):
        for rec in self:
            if rec.employee_id and rec.employee_id.standard_bereich_id and not rec.bereich_id:
                rec.bereich_id = rec.employee_id.standard_bereich_id

    @api.onchange('datum_von')
    def _onchange_datum_von(self):
        for rec in self:
            if rec.datum_von and not rec.datum_bis:
                rec.datum_bis = rec.datum_von + timedelta(hours=8)

    # ---------- Workflow ----------
    def action_publish(self):
        self.write({'state': 'published'})
        return True

    def action_draft(self):
        self.write({'state': 'draft'})
        return True
