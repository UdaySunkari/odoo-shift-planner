# -*- coding: utf-8 -*-
from datetime import timedelta
from odoo import _, api, fields, models
from odoo.exceptions import UserError


class CopyPreviousWeek(models.TransientModel):
    _name = 'dienstplan.copy.previous.week'
    _description = 'Copy a week of shifts to another week'

    quell_woche_start = fields.Date(
        string='Source week (Monday)',
        required=True,
        default=lambda self: self._default_previous_monday(),
        help='Monday of the week the shifts should be copied from.',
    )
    ziel_woche_start = fields.Date(
        string='Target week (Monday)',
        required=True,
        default=lambda self: self._default_monday(),
        help='Monday of the week the shifts should be copied to.',
    )
    nur_veroeffentlichte = fields.Boolean(
        string='Only published shifts',
        default=False,
    )
    bestehende_loeschen = fields.Boolean(
        string='Delete existing shifts in target week first',
        default=False,
        help='Caution: all existing shifts in the target week are '
             'deleted irreversibly before copying.',
    )

    @api.model
    def _default_monday(self):
        today = fields.Date.context_today(self)
        return today - timedelta(days=today.weekday())

    @api.model
    def _default_previous_monday(self):
        return self._default_monday() - timedelta(days=7)

    def action_kopieren(self):
        self.ensure_one()
        if self.ziel_woche_start == self.quell_woche_start:
            raise UserError(_('Source and target week must be different.'))

        Schicht = self.env['dienstplan.schicht']

        quell_start = fields.Datetime.to_datetime(self.quell_woche_start)
        quell_end = quell_start + timedelta(days=7)
        ziel_start = fields.Datetime.to_datetime(self.ziel_woche_start)
        ziel_end = ziel_start + timedelta(days=7)

        offset = ziel_start - quell_start

        if self.bestehende_loeschen:
            existing = Schicht.search([
                ('datum_von', '>=', ziel_start),
                ('datum_von', '<', ziel_end),
            ])
            existing.unlink()

        domain = [
            ('datum_von', '>=', quell_start),
            ('datum_von', '<', quell_end),
        ]
        if self.nur_veroeffentlichte:
            domain.append(('state', '=', 'published'))

        source_shifts = Schicht.search(domain)

        if not source_shifts:
            raise UserError(_('No shifts found in the source week.'))

        vals_list = [{
            'employee_id': s.employee_id.id,
            'bereich_id': s.bereich_id.id,
            'datum_von': s.datum_von + offset,
            'datum_bis': s.datum_bis + offset,
            'notiz': s.notiz or '',
            'state': 'draft',
        } for s in source_shifts]

        Schicht.create(vals_list)
        count = len(vals_list)

        return {
            'type': 'ir.actions.client',
            'tag': 'display_notification',
            'params': {
                'title': _('Week copied'),
                'message': _('%d shift(s) were copied to the target week.') % count,
                'sticky': False,
                'type': 'success',
                'next': {
                    'type': 'ir.actions.act_window_close',
                },
            },
        }
