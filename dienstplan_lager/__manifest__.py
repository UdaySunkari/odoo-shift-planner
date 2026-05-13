# -*- coding: utf-8 -*-
{
    'name': 'Shift Planning Turbo',
    'version': '19.0.4.1.6',
    'category': 'Human Resources',
    'summary': 'Modern weekly shift planner with drag & drop, '
               'TV kiosk display and HR Holidays integration',
    'description': """
Shift Planning Turbo
====================
A fast, modern weekly shift planner for Odoo Community.

Key features
------------
* Weekly grid view with drag & drop scheduling
* Multiple view modes: Day, Week, Month, Year
* Click-to-copy previous week (wizard)
* Mobile-responsive layout with sliding sidebar drawer
* Native integration with hr.leave – approved leaves are
  shown automatically in the planner and on the kiosk
* Public TV/kiosk page with auto-refresh, protected by an
  access token (configurable in System Parameters)
* Color-coded work areas / roles (16-color palette)
* Click-to-edit areas, employees, and absences directly
  from the planner UI
* Per-employee weekly hours target for accurate workload
  bars (full-time vs. part-time)
* Live search across employees, shifts, areas and notes
* Draft & published workflow per shift
* Conflict detection (overlapping shifts) at a glance
* My Schedule – read-only personal schedule for employees
* Print-friendly weekly schedule view
* Email notifications when shifts are published
* Access control: Shift Planner vs Shift Viewer groups
* Settings page for default times, targets, and notifications
* Available in 21 languages including English, German,
  Spanish, French, Italian, Portuguese, Chinese, Japanese,
  Arabic, Russian, Polish, and more
    """,
    'author': 'Uday Kumar Sunkari',
    'website': 'https://github.com/UdaySunkari',
    'license': 'LGPL-3',
    'support': 'udaykumar.sunkari1@gmail.com',
    'price': 19.00,
    'currency': 'EUR',
    'depends': [
        'base',
        'hr',
        'hr_holidays',
        'web',
        'mail',
    ],
    'data': [
        'security/dienstplan_groups.xml',
        'security/ir.model.access.csv',
        'security/dienstplan_rules.xml',
        'data/ir_config_parameter_data.xml',
        'data/dienstplan_bereich_data.xml',
        'data/dienstplan_schicht_vorlage_data.xml',
        'data/mail_template_data.xml',
        'views/dienstplan_bereich_views.xml',
        'views/dienstplan_schicht_views.xml',
        'views/dienstplan_schicht_vorlage_views.xml',
        'views/hr_employee_views.xml',
        'views/res_config_settings_views.xml',
        'views/dienstplan_templates.xml',
        'wizards/copy_previous_week_views.xml',
        'views/dienstplan_menus.xml',
    ],
    'images': [
        'static/description/banner.png',
    ],
    'installable': True,
    'application': True,
    'auto_install': False,
}