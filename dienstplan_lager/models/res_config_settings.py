# -*- coding: utf-8 -*-
from odoo import _, fields, models


class ResConfigSettings(models.TransientModel):
    _inherit = 'res.config.settings'

    dienstplan_default_start_hour = fields.Integer(
        string='Default shift start hour',
        config_parameter='dienstplan_lager.default_start_hour',
        default=8,
    )
    dienstplan_default_start_minute = fields.Integer(
        string='Default shift start minute',
        config_parameter='dienstplan_lager.default_start_minute',
        default=0,
    )
    dienstplan_default_end_hour = fields.Integer(
        string='Default shift end hour',
        config_parameter='dienstplan_lager.default_end_hour',
        default=16,
    )
    dienstplan_default_end_minute = fields.Integer(
        string='Default shift end minute',
        config_parameter='dienstplan_lager.default_end_minute',
        default=30,
    )
    dienstplan_default_weekly_hours = fields.Float(
        string='Default weekly hours target',
        config_parameter='dienstplan_lager.default_weekly_hours',
        default=40.0,
        help='Default weekly hours target for new employees.',
    )
    dienstplan_notify_on_publish = fields.Boolean(
        string='Email employees when shifts are published',
        config_parameter='dienstplan_lager.notify_on_publish',
        default=False,
    )
    dienstplan_kiosk_token = fields.Char(
        string='TV Kiosk Access Token',
        config_parameter='dienstplan_lager.kiosk_token',
        help='Set a secret token to enable the public TV kiosk display. '
             'Leave empty to disable the kiosk entirely.',
    )
    dienstplan_kiosk_refresh = fields.Integer(
        string='Kiosk auto-refresh (seconds)',
        config_parameter='dienstplan_lager.kiosk_refresh',
        default=120,
        help='How often the TV kiosk reloads data automatically.',
    )
    dienstplan_show_weekends = fields.Boolean(
        string='Show Sat & Sun columns',
        config_parameter='dienstplan_lager.show_weekends',
        default=True,
        help='If disabled, the weekly grid only shows Monday–Friday.',
    )
    dienstplan_auto_publish = fields.Boolean(
        string='Auto-publish new shifts',
        config_parameter='dienstplan_lager.auto_publish',
        default=False,
        help='When enabled, new shifts are created as Published instead of Draft.',
    )