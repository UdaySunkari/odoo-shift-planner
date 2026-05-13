# -*- coding: utf-8 -*-
import hashlib
import hmac
import json
import logging
from datetime import datetime, timedelta, time as dtime
from markupsafe import Markup
from odoo import _, http, fields
from odoo.exceptions import AccessError, UserError, ValidationError
from odoo.http import request

_logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
def _initials(name):
    if not name:
        return '?'
    parts = [p for p in name.replace(',', ' ').split() if p]
    if not parts:
        return '?'
    if len(parts) == 1:
        return parts[0][:2].upper()
    return (parts[0][0] + parts[1][0]).upper()


def _avatar_class(emp_id):
    return 'av-%d' % ((int(hashlib.md5(str(emp_id).encode()).hexdigest(), 16) % 8) + 1)


def _week_bounds(offset_int):
    today = datetime.now().date()
    monday = today - timedelta(days=today.weekday()) + timedelta(weeks=offset_int)
    sunday = monday + timedelta(days=6)
    dt_start = datetime.combine(monday, dtime.min)
    dt_end = datetime.combine(sunday, dtime.max)
    return today, monday, sunday, dt_start, dt_end


def _period_bounds(offset_int, view_mode):
    """Generic period boundaries for day/week/month/year views.

    Returns: (today, start_date, end_date, dt_start, dt_end)
    """
    today = datetime.now().date()
    if view_mode == 'day':
        start_date = today + timedelta(days=offset_int)
        end_date = start_date
    elif view_mode == 'month':
        # Anchor on first day of the month
        first_of_this_month = today.replace(day=1)
        # Move offset_int months
        y = first_of_this_month.year
        m = first_of_this_month.month + offset_int
        # Normalise month/year overflow
        while m > 12:
            m -= 12; y += 1
        while m < 1:
            m += 12; y -= 1
        start_date = first_of_this_month.replace(year=y, month=m, day=1)
        # Last day of that month: jump to first of next, minus 1 day
        nm, ny = (1, y + 1) if m == 12 else (m + 1, y)
        end_date = start_date.replace(year=ny, month=nm, day=1) - timedelta(days=1)
    elif view_mode == 'year':
        y = today.year + offset_int
        start_date = today.replace(year=y, month=1, day=1)
        end_date = today.replace(year=y, month=12, day=31)
    else:
        # week (default)
        start_date = today - timedelta(days=today.weekday()) + timedelta(weeks=offset_int)
        end_date = start_date + timedelta(days=6)
    dt_start = datetime.combine(start_date, dtime.min)
    dt_end = datetime.combine(end_date, dtime.max)
    return today, start_date, end_date, dt_start, dt_end


def _kiosk_token():
    """Return the configured kiosk access token, or None if not set.
    The kiosk is disabled by default until an administrator sets a token."""
    return request.env['ir.config_parameter'].sudo().get_param(
        'dienstplan_lager.kiosk_token'
    ) or None


def _safe_error(exc, fallback_key='generic'):
    """Map exceptions to user-safe messages – never leak internals."""
    if isinstance(exc, (UserError, ValidationError)):
        # These are intentionally user-facing
        return str(exc)
    if isinstance(exc, AccessError):
        return _('You do not have permission to perform this action.')
    # Anything else is logged server-side, generic message client-side
    _logger.exception("Shift planning RPC failure")
    return _('An unexpected error occurred. Please contact your administrator.')


def _translations():
    """Translation strings passed to the SPA. Keep keys in sync with app.js."""
    return {
        'loading': _('Loading…'),
        'today': _('Today'),
        'prev_week': _('Previous week'),
        'next_week': _('Next week'),
        'open_kiosk': _('Open TV kiosk'),
        'back_to_odoo': _('Back to Odoo'),
        'search_employee': _('Search employee…'),
        'areas_drag': _('Areas · drag to schedule'),
        'employees_drag': _('Employees · drag to schedule'),
        'planned_hours': _('Planned hours'),
        'occupancy_rate': _('Occupancy rate'),
        'absences': _('Absences'),
        'conflicts': _('Conflicts'),
        'target': _('Target: %sh'),
        'optimal': _('Optimal'),
        'ok': _('OK'),
        'low': _('Low'),
        'check': _('Check!'),
        'all_ok': _('All OK'),
        'days': _('Days'),
        'no_shifts_title': _('No shifts this week'),
        'no_shifts_hint': _('Drag an employee from the sidebar onto a cell '
                            'to create a shift.'),
        'new_shift': _('+ new shift'),
        'sum_per_day': _('Sum / day'),
        'pull_employee_here': _('Pull employee here'),
        'employee': _('Employee'),
        'add_employee_first': _('Add an employee first'),
        'no_area_available': _('No area available – create areas first'),
        'shift_created': _('Shift created'),
        'shift_moved': _('Shift moved'),
        'shift_deleted': _('Shift deleted'),
        'time_incomplete': _('Time is incomplete'),
        'confirm_delete': _('Really delete this shift?'),
        'delete': _('Delete'),
        'save': _('Save'),
        'cancel': _('Cancel'),
        'publish': _('Publish'),
        'unpublish': _('Unpublish'),
        'note': _('Note'),
        'from': _('From'),
        'to': _('To'),
        'absence': _('Absence'),
        'all_day': _('All day'),
        'mitarbeiter': _('Employee'),
        'error_prefix': _('Error: '),
        'rpc_error': _('Communication error'),
        'draft': _('Draft'),
        'published': _('Published'),
        'day_short_mon': _('Mon'),
        'day_short_tue': _('Tue'),
        'day_short_wed': _('Wed'),
        'day_short_thu': _('Thu'),
        'day_short_fri': _('Fri'),
        'day_short_sat': _('Sat'),
        'day_short_sun': _('Sun'),
        'week_label': _('CW %(kw)s · %(from)s – %(to)s'),
        # New strings for manual creation dialogs
        'add_shift': _('Add new shift'),
        'add_shift_short': _('Shift'),
        'add_employee': _('Add new employee'),
        'add_area': _('Add new area'),
        'create': _('Create'),
        'work_email': _('Work email (optional)'),
        'default_area': _('Default area (optional)'),
        'short_code_optional': _('Short code (optional)'),
        'color': _('Color'),
        'is_absence_type': _('This is an absence type'),
        'select_employee': _('Select employee'),
        'select_area': _('Select area'),
        'select_day': _('Select day'),
        'name_required': _('Name is required'),
        'employee_created': _('Employee created'),
        'edit_employee': _('Edit employee'),
        'employee_updated': _('Employee updated'),
        'employee_deleted': _('Employee deleted'),
        'employee_archived': _('Employee archived (still has shifts)'),
        'confirm_delete_employee': _('Really delete employee "%s"?'),
        'remove_from_week_title': _('Remove from view'),
        'employee_added_to_view': _('Employee added — drag areas or shift templates onto their row'),
        'confirm_clear_period': _('Remove %(name)s from this view? %(n)s shift(s) will be deleted.'),
        'period_cleared': _('Cleared %(n)s shift(s)'),
        'nothing_to_clear': _('No shifts in this view to clear'),
        # Card popovers (Planned Hours / Absences / Schedule Health)
        'close': _('Close'),
        'cp_planned': _('Planned'),
        'cp_target': _('Target'),
        'cp_gap': _('Gap'),
        'cp_no_people': _('No people scheduled yet'),
        'cp_sorted_by_pct': _('employees · sorted by capacity used'),
        'cp_no_absences': _('No absences this week'),
        'cp_no_absences_sub': _('Everyone is available.'),
        'cp_jump': _('Jump'),
        'cp_day': _('day'),
        'cp_days': _('days'),
        'cp_person': _('person'),
        'cp_people': _('people'),
        'cp_people_affected': _('people affected'),
        # Schedule Health checks
        'hp_title': _('Schedule Health'),
        'hp_issue': _('issue'),
        'hp_issues': _('issues'),
        'hp_all_clear': _('All clear'),
        'hp_healthy_title': _('Schedule is healthy'),
        'hp_healthy_sub': _('No conflicts, no overtime, nothing needs attention.'),
        'hp_overlaps': _('OVERLAPS'),
        'hp_overlap_desc': _('Two %a shifts at %t fully overlap.'),
        'hp_overtime': _('OVERTIME'),
        'hp_overtime_desc': _('Target %t h. Currently %o h over the weekly limit.'),
        'hp_empty_rows': _('EMPTY ROWS'),
        'hp_empty_row_title': _('in view but no shifts'),
        'hp_empty_row_desc': _('Added to the planner but nothing scheduled yet.'),
        'hp_drafts': _('DRAFT SHIFTS'),
        'hp_drafts_title': _('shifts still in draft'),
        'hp_drafts_desc': _("Not yet published — employees can't see them in their schedule."),
        'hp_jump': _('Jump to shift'),
        'hp_delete_duplicate': _('Delete duplicate'),
        'hp_resolve_overlap': _('Resolve…'),
        'hp_resolve_title': _('Resolve overlap'),
        'hp_resolve_intro': _('Two shifts overlap. Choose which one to keep.'),
        'hp_resolve_hint': _('Tip: jump to see the shift in the grid first'),
        'hp_delete_this': _('Delete this'),
        'hp_on_leave': _('on leave'),
        'hp_review': _('Review shifts'),
        'hp_add_shift': _('Add shift'),
        'hp_remove_row': _('Remove from view'),
        'hp_publish_all': _('Publish all'),
        'hp_publish_confirm': _('Publish %n shift(s)?'),
        'hp_published_n': _('Published %n shift(s)'),
        'hp_refresh': _('Refresh'),
        'hp_last_checked': _('Last checked: just now'),
        'area_created': _('Area created'),
        'edit_area': _('Edit area'),
        'area_updated': _('Area updated'),
        'area_deleted': _('Area deleted'),
        'area_archived': _('Area archived (still used by existing shifts)'),
        'confirm_delete_area': _('Really delete area "%s"?'),
        'absence_managed_in_hr': _('Absences come from HR Holidays. Deleting here will also remove the time off record from HR.'),
        'confirm_delete_absence': _('Really delete the absence for %s?'),
        'absence_deleted': _('Absence deleted'),
        # Shift templates
        'templates_drag': _('TEMPLATES · DRAG TO SCHEDULE'),
        'add_template': _('Add new template'),
        'edit_template': _('Edit template'),
        'template_created': _('Template created'),
        'template_updated': _('Template updated'),
        'template_deleted': _('Template deleted'),
        'confirm_delete_template': _('Really delete template "%s"?'),
        'no_templates_hint': _('No templates yet. Click + to create one.'),
        'optional': _('optional'),
        # View modes & global search
        'view_day': _('Day'),
        'view_week': _('Week'),
        'view_month': _('Month'),
        'view_year': _('Year'),
        'prev_period': _('Previous period'),
        'next_period': _('Next period'),
        'search_anything': _('Search employees, shifts, areas…'),
        'shifts_lc': _('shifts'),
        # ---- Crew / filter dropdown (renderCrewDropdown in app.js) ----
        'crew_filter': _('Filter'),
        'crew_filter_shifts': _('Filter shifts'),
        'crew_this_week': _('This week'),
        'crew_custom_filter': _('Custom filter'),
        'crew_group_by': _('Group by'),
        'crew_coming_soon': _('Coming soon'),
        'crew_group_area': _('Area'),
        'crew_group_status': _('Status'),
        'crew_group_employee': _('Employee'),
        'crew_custom_group': _('Custom group'),
        'crew_favorites': _('Favorites'),
        'crew_saved_teams': _('Your saved teams'),
        'crew_all': _('All'),
        'crew_no_favorites': _('No favorites yet.'),
        'crew_no_favorites_hint': _('Click on "%(label)s".'),
        'crew_save_current_search': _('Save current search'),
        'crew_kbd_apply': _('Apply'),
        'crew_kbd_close': _('Close'),
        'crew_kbd_navigate': _('Navigate'),
        'crew_favorite_prefix': _('Favorite "%(name)s"'),
        'crew_filters_active': _('%(n)s filter active'),
        'crew_filters_active_plural': _('%(n)s filters active'),
        'crew_reset_all': _('Reset all'),
        'crew_remove_filter': _('Remove filter'),
        'crew_arrow_title': _('Filter / Group / Favorites'),
        'crew_new_filter': _('New filter'),
        'crew_filter_name': _('Filter name'),
        'crew_filter_name_placeholder': _('e.g. Warehouse'),
        'crew_include_people': _('Include these people'),
        'crew_search_employees': _('Search employees…'),
        'crew_no_employees': _('No employees'),
        'crew_selected_of': _('%(n)s of %(total)s selected'),
        'crew_save_filter': _('Save filter'),
        'crew_delete': _('Delete'),
        'app_footer_brand': _('Shift Planning · Workforce Scheduler'),
        # Month names (used by the JS calendar header)
        'month_january': _('January'),
        'month_february': _('February'),
        'month_march': _('March'),
        'month_april': _('April'),
        'month_may': _('May'),
        'month_june': _('June'),
        'month_july': _('July'),
        'month_august': _('August'),
        'month_september': _('September'),
        'month_october': _('October'),
        'month_november': _('November'),
        'month_december': _('December'),
    }


# ---------------------------------------------------------------------------
# Planning – authenticated SPA
# ---------------------------------------------------------------------------
class DienstplanPlanung(http.Controller):
    """SPA shell + JSON API for the interactive shift planner."""

    @http.route(
        '/dienstplan/planung',
        type='http',
        auth='user',
        website=False,
        sitemap=False,
    )
    def planung(self, **kwargs):
        # Only planners can access the full planning SPA
        if not request.env.user.has_group('dienstplan_lager.group_dienstplan_planner'):
            return request.redirect('/dienstplan/my-schedule')
        # Safely embed translations in a <script type="application/json"> tag.
        # ensure_ascii avoids non-ASCII issues; replacing </ defeats any
        # accidental </script> sequence inside translated strings.
        payload = json.dumps(_translations(), ensure_ascii=True).replace('</', '<\\/')
        lang = request.env.lang or 'en_US'
        return request.render('dienstplan_lager.planung_template', {
            'i18n_json': Markup(payload),
            'user_lang_short': lang.split('_')[0],
        })

    # ------------------------------------------------------------------
    # JSON API: load data for the current period (day / week / month / year)
    # The route is still /api/week for backwards compatibility.
    # ------------------------------------------------------------------
    @http.route('/dienstplan/api/week', type='json', auth='user')
    def api_week(self, offset=0, view_mode='week', **kwargs):
        try:
            offset_int = int(offset)
        except (TypeError, ValueError):
            offset_int = 0
        if view_mode not in ('day', 'week', 'month', 'year'):
            view_mode = 'week'

        today, start_date, end_date, dt_start, dt_end = _period_bounds(
            offset_int, view_mode)

        Employee = request.env['hr.employee']
        Schicht = request.env['dienstplan.schicht']
        Bereich = request.env['dienstplan.bereich']
        Leave = request.env['hr.leave']

        all_employees = Employee.search([('active', '=', True)], order='name')
        all_bereiche = Bereich.search([('active', '=', True)],
                                      order='sequence, name')
        all_vorlagen = request.env['dienstplan.schicht.vorlage'].search(
            [('active', '=', True)], order='sequence, name')

        shifts = Schicht.search([
            ('datum_von', '>=', dt_start),
            ('datum_von', '<=', dt_end),
        ], order='datum_von')

        leaves = Leave.search([
            ('state', '=', 'validate'),
            ('date_from', '<=', dt_end),
            ('date_to', '>=', dt_start),
        ])

        # Read admin-configurable shift defaults from System Parameters.
        # These are set via Settings → Shift Planning and replace the
        # previously hardcoded values in the frontend.
        ICP = request.env['ir.config_parameter'].sudo()
        defaults = {
            'start_hour': int(ICP.get_param(
                'dienstplan_lager.default_start_hour', '8')),
            'start_minute': int(ICP.get_param(
                'dienstplan_lager.default_start_minute', '0')),
            'end_hour': int(ICP.get_param(
                'dienstplan_lager.default_end_hour', '16')),
            'end_minute': int(ICP.get_param(
                'dienstplan_lager.default_end_minute', '30')),
            'weekly_hours': float(ICP.get_param(
                'dienstplan_lager.default_weekly_hours', '40.0')),
        }

        # Build per-day list spanning the period (used by day/week views).
        days = []
        cur = start_date
        while cur <= end_date:
            days.append(cur.isoformat())
            cur = cur + timedelta(days=1)

        # For backwards compatibility we still expose monday/sunday when the
        # view is 'week'. For other views we use the period start/end.
        is_week = view_mode == 'week'
        return {
            'defaults': defaults,
            'view_mode': view_mode,
            'start_date': start_date.isoformat(),
            'end_date': end_date.isoformat(),
            'monday': start_date.isoformat() if is_week else start_date.isoformat(),
            'sunday': end_date.isoformat() if is_week else end_date.isoformat(),
            'today': today.isoformat(),
            'kw': start_date.isocalendar()[1] if is_week else None,
            'jahr': start_date.year,
            'offset': offset_int,
            'days': days,
            'all_employees': [{
                'id': e.id,
                'name': e.name or '?',
                'work_email': e.work_email or '',
                'initials': _initials(e.name),
                'avatar_class': _avatar_class(e.id),
                'standard_bereich_id': e.standard_bereich_id.id if e.standard_bereich_id else None,
                'role': (e.standard_bereich_id.name if e.standard_bereich_id
                         else (e.job_title or _('Employee'))),
                'weekly_hours_target': e.weekly_hours_target or 40.0,
            } for e in all_employees],
            'all_bereiche': [{
                'id': b.id,
                'name': b.name,
                'code': b.code or b.name,
                'color': b.html_color or '#6366f1',
                'ist_abwesenheit': bool(b.ist_abwesenheit),
            } for b in all_bereiche],
            'all_vorlagen': [{
                'id': v.id,
                'name': v.name,
                'bereich_id': v.bereich_id.id if v.bereich_id else None,
                'bereich_name': v.bereich_id.name if v.bereich_id else None,
                'start_hour': v.start_hour,
                'start_minute': v.start_minute,
                'end_hour': v.end_hour,
                'end_minute': v.end_minute,
                'duration_hours': v.duration_hours,
                'color': v.html_color or (v.bereich_id.html_color if v.bereich_id else '#6366f1'),
            } for v in all_vorlagen],
            'shifts': [{
                'id': s.id,
                'employee_id': s.employee_id.id,
                'employee_name': s.employee_id.name,
                'bereich_id': s.bereich_id.id,
                'bereich_name': s.bereich_id.name,
                'bereich_code': s.bereich_id.code or s.bereich_id.name,
                'bereich_color': s.bereich_id.html_color or '#6366f1',
                'is_leave': bool(s.ist_abwesenheit),
                'state': s.state,
                'datum_von': fields.Datetime.to_string(s.datum_von),
                'datum_bis': fields.Datetime.to_string(s.datum_bis),
                'notiz': s.notiz or '',
            } for s in shifts],
            'leaves': [{
                'id': l.id,
                'employee_id': l.employee_id.id,
                'date_from': fields.Datetime.to_string(l.date_from),
                'date_to': fields.Datetime.to_string(l.date_to),
                # NOTE: holiday_status_id.name intentionally NOT returned here
                # to avoid exposing sensitive leave types.
                'name': _('Absence'),
            } for l in leaves],
        }

    # ------------------------------------------------------------------
    # JSON API: create a shift
    # ------------------------------------------------------------------
    @http.route('/dienstplan/api/shift/create', type='json', auth='user')
    def api_shift_create(self, employee_id=None, bereich_id=None,
                         datum_von=None, datum_bis=None, **kwargs):
        if not employee_id or not bereich_id:
            return {'error': _('employee_id and bereich_id are required.')}
        try:
            vals = {
                'employee_id': int(employee_id),
                'bereich_id': int(bereich_id),
                'datum_von': fields.Datetime.from_string(datum_von),
                'datum_bis': fields.Datetime.from_string(datum_bis),
                'state': 'draft',
            }
            if kwargs.get('notiz'):
                vals['notiz'] = kwargs['notiz']
            s = request.env['dienstplan.schicht'].create(vals)
            return {'ok': True, 'id': s.id}
        except Exception as e:
            return {'error': _safe_error(e)}

    # ------------------------------------------------------------------
    # JSON API: create a new employee from the planner sidebar.
    # Standard Odoo ACL on hr.employee applies (HR managers may create).
    # ------------------------------------------------------------------
    @http.route('/dienstplan/api/employee/create', type='json', auth='user')
    def api_employee_create(self, name=None, work_email=None,
                            standard_bereich_id=None, **kwargs):
        if not name or not name.strip():
            return {'error': _('Name is required.')}
        try:
            vals = {'name': name.strip()}
            if work_email and work_email.strip():
                vals['work_email'] = work_email.strip()
            if standard_bereich_id:
                vals['standard_bereich_id'] = int(standard_bereich_id)
            emp = request.env['hr.employee'].create(vals)
            return {'ok': True, 'id': emp.id, 'name': emp.name}
        except Exception as e:
            return {'error': _safe_error(e)}

    # ------------------------------------------------------------------
    # JSON API: delete an employee from the planner sidebar.
    # Smart-delete: archive if shifts exist, hard-delete otherwise.
    # ------------------------------------------------------------------
    @http.route('/dienstplan/api/employee/delete', type='json', auth='user')
    def api_employee_delete(self, id=None, **kwargs):
        try:
            emp = request.env['hr.employee'].browse(int(id))
            if not emp.exists():
                return {'error': _('Employee not found.')}
            shift_count = request.env['dienstplan.schicht'].search_count(
                [('employee_id', '=', emp.id)])
            if shift_count > 0:
                emp.write({'active': False})
                return {'ok': True, 'archived': True,
                        'shift_count': shift_count}
            emp.unlink()
            return {'ok': True, 'archived': False}
        except Exception as e:
            return {'error': _safe_error(e)}

    # ------------------------------------------------------------------
    # JSON API: update an employee from the planner sidebar.
    # ------------------------------------------------------------------
    @http.route('/dienstplan/api/employee/update', type='json', auth='user')
    def api_employee_update(self, id=None, vals=None, **kwargs):
        try:
            emp = request.env['hr.employee'].browse(int(id))
            if not emp.exists():
                return {'error': _('Employee not found.')}
            allowed = {'name', 'work_email', 'standard_bereich_id',
                       'weekly_hours_target'}
            clean = {}
            for k, v in (vals or {}).items():
                if k not in allowed:
                    continue
                if k == 'name':
                    name = (v or '').strip()
                    if not name:
                        return {'error': _('Name is required.')}
                    clean[k] = name
                elif k == 'standard_bereich_id':
                    clean[k] = int(v) if v else False
                elif k == 'weekly_hours_target':
                    clean[k] = float(v) if v else 40.0
                else:
                    clean[k] = v
            if clean:
                emp.write(clean)
            return {'ok': True}
        except Exception as e:
            return {'error': _safe_error(e)}

    # ------------------------------------------------------------------
    # JSON API: create a new area (Bereich) from the planner sidebar.
    # Standard Odoo ACL on dienstplan.bereich applies (HR managers).
    # ------------------------------------------------------------------
    @http.route('/dienstplan/api/bereich/create', type='json', auth='user')
    def api_bereich_create(self, name=None, code=None, html_color=None,
                           ist_abwesenheit=False, **kwargs):
        if not name or not name.strip():
            return {'error': _('Name is required.')}
        try:
            vals = {'name': name.strip()}
            if code and code.strip():
                vals['code'] = code.strip()
            if html_color and html_color.strip():
                vals['html_color'] = html_color.strip()
            if ist_abwesenheit:
                vals['ist_abwesenheit'] = True
            b = request.env['dienstplan.bereich'].create(vals)
            return {'ok': True, 'id': b.id, 'name': b.name}
        except Exception as e:
            return {'error': _safe_error(e)}

    # ------------------------------------------------------------------
    # JSON API: update an area (Bereich)
    # ------------------------------------------------------------------
    @http.route('/dienstplan/api/bereich/update', type='json', auth='user')
    def api_bereich_update(self, id=None, vals=None, **kwargs):
        try:
            b = request.env['dienstplan.bereich'].browse(int(id))
            if not b.exists():
                return {'error': _('Area not found.')}
            allowed = {'name', 'code', 'html_color', 'ist_abwesenheit',
                       'sequence', 'notiz'}
            clean = {}
            for k, v in (vals or {}).items():
                if k not in allowed:
                    continue
                if k == 'name':
                    name = (v or '').strip()
                    if not name:
                        return {'error': _('Name is required.')}
                    clean[k] = name
                elif k == 'code':
                    clean[k] = (v or '').strip() or False
                elif k == 'html_color':
                    clean[k] = (v or '').strip() or False
                elif k == 'ist_abwesenheit':
                    clean[k] = bool(v)
                else:
                    clean[k] = v
            if clean:
                b.write(clean)
            return {'ok': True, 'id': b.id}
        except Exception as e:
            return {'error': _safe_error(e)}

    # ------------------------------------------------------------------
    # JSON API: delete an area (Bereich).
    # Smart-delete: if the area is referenced by shifts, archive it
    # (set active=False) instead of unlinking. Otherwise hard-delete.
    # ------------------------------------------------------------------
    @http.route('/dienstplan/api/bereich/delete', type='json', auth='user')
    def api_bereich_delete(self, id=None, **kwargs):
        try:
            b = request.env['dienstplan.bereich'].browse(int(id))
            if not b.exists():
                return {'error': _('Area not found.')}
            shift_count = request.env['dienstplan.schicht'].search_count(
                [('bereich_id', '=', b.id)])
            if shift_count > 0:
                # Archive instead of unlinking so existing shifts stay valid
                b.write({'active': False})
                return {'ok': True, 'archived': True,
                        'shift_count': shift_count}
            b.unlink()
            return {'ok': True, 'archived': False}
        except Exception as e:
            return {'error': _safe_error(e)}

    # ------------------------------------------------------------------
    # JSON API: shift template (Vorlage) CRUD
    # ------------------------------------------------------------------
    @http.route('/dienstplan/api/vorlage/create', type='json', auth='user')
    def api_vorlage_create(self, name=None, bereich_id=None,
                           start_hour=8, start_minute=0,
                           end_hour=16, end_minute=30,
                           html_color=None, **kwargs):
        if not name or not name.strip():
            return {'error': _('Name is required.')}
        try:
            vals = {
                'name': name.strip(),
                'start_hour': int(start_hour),
                'start_minute': int(start_minute),
                'end_hour': int(end_hour),
                'end_minute': int(end_minute),
            }
            if bereich_id:
                vals['bereich_id'] = int(bereich_id)
            if html_color and html_color.strip():
                vals['html_color'] = html_color.strip()
            v = request.env['dienstplan.schicht.vorlage'].create(vals)
            return {'ok': True, 'id': v.id, 'name': v.name}
        except Exception as e:
            return {'error': _safe_error(e)}

    @http.route('/dienstplan/api/vorlage/update', type='json', auth='user')
    def api_vorlage_update(self, id=None, vals=None, **kwargs):
        try:
            v = request.env['dienstplan.schicht.vorlage'].browse(int(id))
            if not v.exists():
                return {'error': _('Template not found.')}
            allowed = {'name', 'bereich_id', 'start_hour', 'start_minute',
                       'end_hour', 'end_minute', 'html_color', 'sequence',
                       'notiz'}
            clean = {}
            for k, val in (vals or {}).items():
                if k not in allowed:
                    continue
                if k == 'name':
                    nm = (val or '').strip()
                    if not nm:
                        return {'error': _('Name is required.')}
                    clean[k] = nm
                elif k == 'bereich_id':
                    clean[k] = int(val) if val else False
                elif k in ('start_hour', 'start_minute', 'end_hour',
                           'end_minute', 'sequence'):
                    clean[k] = int(val)
                elif k == 'html_color':
                    clean[k] = (val or '').strip() or False
                else:
                    clean[k] = val
            if clean:
                v.write(clean)
            return {'ok': True, 'id': v.id}
        except Exception as e:
            return {'error': _safe_error(e)}

    @http.route('/dienstplan/api/vorlage/delete', type='json', auth='user')
    def api_vorlage_delete(self, id=None, **kwargs):
        try:
            v = request.env['dienstplan.schicht.vorlage'].browse(int(id))
            if not v.exists():
                return {'error': _('Template not found.')}
            v.unlink()
            return {'ok': True}
        except Exception as e:
            return {'error': _safe_error(e)}

    # ------------------------------------------------------------------
    # JSON API: delete an approved leave (Absence) directly from the planner.
    # The underlying hr.leave record is removed. Permissions are enforced
    # by Odoo's standard Holidays ACLs — if the current user lacks rights
    # the call returns a translated permission error.
    # ------------------------------------------------------------------
    @http.route('/dienstplan/api/leave/delete', type='json', auth='user')
    def api_leave_delete(self, id=None, **kwargs):
        try:
            leave = request.env['hr.leave'].browse(int(id))
            if not leave.exists():
                return {'error': _('Absence not found.')}
            # If the leave is approved, refuse it first to properly unwind
            # the workflow (restore balance, etc.), then unlink.
            if leave.state in ('validate', 'validate1', 'confirm'):
                try:
                    leave.action_refuse()
                except Exception:
                    # If refuse fails (e.g. version differences), fall
                    # through to the unlink attempt below.
                    pass
            leave.unlink()
            return {'ok': True}
        except Exception as e:
            return {'error': _safe_error(e)}


    # ------------------------------------------------------------------
    # JSON API: update a shift
    # ------------------------------------------------------------------
    @http.route('/dienstplan/api/shift/update', type='json', auth='user')
    def api_shift_update(self, id=None, vals=None, **kwargs):
        try:
            s = request.env['dienstplan.schicht'].browse(int(id))
            if not s.exists():
                return {'error': _('Shift not found.')}
            allowed = {'employee_id', 'bereich_id', 'datum_von', 'datum_bis',
                       'state', 'notiz'}
            clean_vals = {}
            for k, v in (vals or {}).items():
                if k not in allowed:
                    continue
                if k in ('datum_von', 'datum_bis') and v:
                    clean_vals[k] = fields.Datetime.from_string(v)
                elif k in ('employee_id', 'bereich_id'):
                    clean_vals[k] = int(v)
                else:
                    clean_vals[k] = v
            s.write(clean_vals)
            return {'ok': True}
        except Exception as e:
            return {'error': _safe_error(e)}

    # ------------------------------------------------------------------
    # JSON API: delete a shift
    # ------------------------------------------------------------------
    @http.route('/dienstplan/api/shift/delete', type='json', auth='user')
    def api_shift_delete(self, id=None, **kwargs):
        try:
            s = request.env['dienstplan.schicht'].browse(int(id))
            if not s.exists():
                return {'error': _('Shift not found.')}
            s.unlink()
            return {'ok': True}
        except Exception as e:
            return {'error': _safe_error(e)}

    # ------------------------------------------------------------------
    # JSON API: clear all of one employee's shifts in a given period.
    # Used by the "× remove from week" button on the grid row, so the
    # planner can wipe a person from the current view in one click
    # instead of deleting shifts one by one.
    # ------------------------------------------------------------------
    @http.route('/dienstplan/api/shift/clear_period', type='json', auth='user')
    def api_shift_clear_period(self, employee_id=None, offset=0,
                               view_mode='week', **kwargs):
        try:
            if not request.env.user.has_group(
                    'dienstplan_lager.group_dienstplan_planner'):
                return {'error': _('Permission denied. '
                                   'Only Shift Planners can do this.')}
            if not employee_id:
                return {'error': _('No employee given.')}
            try:
                offset_int = int(offset)
            except (TypeError, ValueError):
                offset_int = 0
            if view_mode not in ('day', 'week', 'month', 'year'):
                view_mode = 'week'
            _, _, _, dt_start, dt_end = _period_bounds(offset_int, view_mode)
            shifts = request.env['dienstplan.schicht'].search([
                ('employee_id', '=', int(employee_id)),
                ('datum_von', '>=', dt_start),
                ('datum_von', '<=', dt_end),
            ])
            count = len(shifts)
            if count:
                shifts.unlink()
            return {'ok': True, 'deleted': count}
        except Exception as e:
            return {'error': _safe_error(e)}

    # ------------------------------------------------------------------
    # JSON API: publish / unpublish
    # ------------------------------------------------------------------
    @http.route('/dienstplan/api/shift/publish', type='json', auth='user')
    def api_shift_publish(self, id=None, publish=True, **kwargs):
        try:
            s = request.env['dienstplan.schicht'].browse(int(id))
            if not s.exists():
                return {'error': _('Shift not found.')}
            s.state = 'published' if publish else 'draft'

            # Send email notification if enabled and shift was published
            if publish:
                notify = request.env['ir.config_parameter'].sudo().get_param(
                    'dienstplan_lager.notify_on_publish', 'False')
                if notify and notify.lower() not in ('false', '0', ''):
                    work_email = s.employee_id.work_email
                    if work_email:
                        try:
                            template = request.env.ref(
                                'dienstplan_lager.mail_template_shift_published',
                                raise_if_not_found=False)
                            if template:
                                template.sudo().send_mail(s.id, force_send=False)
                        except Exception:
                            _logger.warning(
                                "Failed to send publish notification for shift %s",
                                s.id, exc_info=True)

            return {'ok': True, 'state': s.state}
        except Exception as e:
            return {'error': _safe_error(e)}

    # ------------------------------------------------------------------
    # Settings API – read/write from the planner UI
    # ------------------------------------------------------------------
    @http.route('/dienstplan/api/settings/get', type='json', auth='user')
    def api_settings_get(self, **kw):
        """Return all configurable settings for the planner.

        Restricted to the Shift Planner group because the response
        includes the kiosk_token, which is the secret guarding the
        public /dienstplan/kiosk URL. Leaking it to ordinary users
        would let them share roster data outside the company.
        """
        try:
            if not request.env.user.has_group(
                    'dienstplan_lager.group_dienstplan_planner'):
                return {'error': _('Permission denied. '
                                   'Only Shift Planners can view settings.')}
            ICP = request.env['ir.config_parameter'].sudo()
            return {
                'start_hour': int(ICP.get_param('dienstplan_lager.default_start_hour', '8')),
                'start_minute': int(ICP.get_param('dienstplan_lager.default_start_minute', '0')),
                'end_hour': int(ICP.get_param('dienstplan_lager.default_end_hour', '16')),
                'end_minute': int(ICP.get_param('dienstplan_lager.default_end_minute', '30')),
                'weekly_hours': float(ICP.get_param('dienstplan_lager.default_weekly_hours', '40.0')),
                'show_weekends': ICP.get_param('dienstplan_lager.show_weekends', 'True') == 'True',
                'auto_publish': ICP.get_param('dienstplan_lager.auto_publish', 'False') == 'True',
                'notify_on_publish': ICP.get_param('dienstplan_lager.notify_on_publish', 'False') == 'True',
                'kiosk_token': ICP.get_param('dienstplan_lager.kiosk_token', '') or '',
                'kiosk_refresh': int(ICP.get_param('dienstplan_lager.kiosk_refresh', '120')),
            }
        except Exception as e:
            return {'error': _safe_error(e)}

    @http.route('/dienstplan/api/settings/update', type='json', auth='user')
    def api_settings_update(self, vals=None, **kw):
        """Update planner settings. Only Shift Planner group can do this."""
        try:
            if not vals:
                return {'error': _('No values provided.')}
            # Check permission: only planners/managers
            if not request.env.user.has_group('dienstplan_lager.group_dienstplan_planner'):
                return {'error': _('Permission denied. '
                                   'Only Shift Planners can change settings.')}
            ICP = request.env['ir.config_parameter'].sudo()
            param_map = {
                'start_hour': 'dienstplan_lager.default_start_hour',
                'start_minute': 'dienstplan_lager.default_start_minute',
                'end_hour': 'dienstplan_lager.default_end_hour',
                'end_minute': 'dienstplan_lager.default_end_minute',
                'weekly_hours': 'dienstplan_lager.default_weekly_hours',
                'show_weekends': 'dienstplan_lager.show_weekends',
                'auto_publish': 'dienstplan_lager.auto_publish',
                'notify_on_publish': 'dienstplan_lager.notify_on_publish',
                'kiosk_token': 'dienstplan_lager.kiosk_token',
                'kiosk_refresh': 'dienstplan_lager.kiosk_refresh',
            }
            for key, value in vals.items():
                param = param_map.get(key)
                if param:
                    ICP.set_param(param, str(value))
            return {'ok': True}
        except Exception as e:
            return {'error': _safe_error(e)}

    # ------------------------------------------------------------------
    # Print view – authenticated, no token needed
    # ------------------------------------------------------------------
    @http.route('/dienstplan/print', type='http', auth='user',
                website=False, sitemap=False)
    def print_view(self, offset='0', **kwargs):
        """Authenticated print-friendly schedule view."""
        if not request.env.user.has_group('dienstplan_lager.group_dienstplan_planner'):
            return request.redirect('/dienstplan/my-schedule')
        try:
            offset_int = int(offset)
        except (TypeError, ValueError):
            offset_int = 0

        today, monday, sunday, dt_start, dt_end = _week_bounds(offset_int)

        # No sudo() here: the planner-group check above already gates access,
        # and the record rules in dienstplan_rules.xml correctly scope shifts
        # to the user's active company. Calling sudo() would bypass that rule
        # and merge data from every company in the database into one print
        # page, which is a real cross-tenant leak on multi-company instances.
        Schicht = request.env['dienstplan.schicht']
        shifts = Schicht.search([
            ('datum_von', '>=', dt_start),
            ('datum_von', '<=', dt_end),
        ], order='employee_id, datum_von')

        Leave = request.env['hr.leave']
        leaves = Leave.search([
            ('state', '=', 'validate'),
            ('date_from', '<=', dt_end),
            ('date_to', '>=', dt_start),
        ])

        employee_ids = (set(shifts.mapped('employee_id.id'))
                        | set(leaves.mapped('employee_id.id')))
        employees = request.env['hr.employee'].browse(
            list(employee_ids)).sorted('name')

        grid = {}
        for emp in employees:
            grid[emp.id] = {
                'name': emp.name,
                'days': {i: [] for i in range(7)},
            }

        for shift in shifts:
            day_idx = (shift.datum_von.date() - monday).days
            if 0 <= day_idx <= 6:
                grid[shift.employee_id.id]['days'][day_idx].append({
                    'bereich': shift.bereich_id.name,
                    'code': shift.bereich_id.code or shift.bereich_id.name,
                    'color': shift.bereich_id.html_color or '#3498db',
                    'von': shift.datum_von.strftime('%H:%M'),
                    'bis': shift.datum_bis.strftime('%H:%M'),
                    'is_leave': shift.ist_abwesenheit,
                })

        absence_label = _('Absent')
        for leave in leaves:
            emp_id = leave.employee_id.id
            if emp_id not in grid:
                continue
            start = max(leave.date_from.date(), monday)
            end = min(leave.date_to.date(), sunday)
            cur = start
            while cur <= end:
                day_idx = (cur - monday).days
                if 0 <= day_idx <= 6:
                    grid[emp_id]['days'][day_idx].append({
                        'bereich': absence_label,
                        'code': _('OFF'),
                        'color': '#95a5a6',
                        'von': '',
                        'bis': '',
                        'is_leave': True,
                    })
                cur += timedelta(days=1)

        day_names = [_('Monday'), _('Tuesday'), _('Wednesday'),
                     _('Thursday'), _('Friday'), _('Saturday'),
                     _('Sunday')]
        days = [monday + timedelta(days=i) for i in range(7)]

        values = {
            'grid': grid,
            'days': days,
            'day_names': day_names,
            'monday': monday,
            'sunday': sunday,
            'kw': monday.isocalendar()[1],
            'jahr': monday.year,
            'now': datetime.now(),
            'today': today,
            'offset': offset_int,
            'user_lang_short': (request.env.lang or 'en_US').split('_')[0],
            'lbl_title': _('Shift Planning'),
            'lbl_cw': _('CW'),
            'lbl_employee': _('Employee'),
            'lbl_no_data': _('No shifts for this week.'),
            'lbl_footer': _('Printed:'),
            'lbl_print': _('Print'),
        }
        return request.render('dienstplan_lager.print_template', values)

    # ------------------------------------------------------------------
    # My Schedule – read-only view for employees
    # ------------------------------------------------------------------
    @http.route('/dienstplan/my-schedule', type='http', auth='user',
                website=False, sitemap=False)
    def my_schedule(self, offset='0', **kwargs):
        """Read-only schedule page for logged-in employees.

        Shows only the current user's published shifts. No editing.
        """
        try:
            offset_int = int(offset)
        except (TypeError, ValueError):
            offset_int = 0

        # Find the employee linked to the current user
        employee = request.env['hr.employee'].sudo().search(
            [('user_id', '=', request.env.uid)], limit=1)

        today, monday, sunday, dt_start, dt_end = _week_bounds(offset_int)

        shifts_data = []
        leaves_data = []

        if employee:
            Schicht = request.env['dienstplan.schicht'].sudo()
            shifts = Schicht.search([
                ('datum_von', '>=', dt_start),
                ('datum_von', '<=', dt_end),
                ('employee_id', '=', employee.id),
                ('state', '=', 'published'),
            ], order='datum_von')

            for shift in shifts:
                day_idx = (shift.datum_von.date() - monday).days
                if 0 <= day_idx <= 6:
                    shifts_data.append({
                        'day_idx': day_idx,
                        'bereich': shift.bereich_id.name,
                        'code': shift.bereich_id.code or shift.bereich_id.name,
                        'color': shift.bereich_id.html_color or '#3498db',
                        'von': shift.datum_von.strftime('%H:%M'),
                        'bis': shift.datum_bis.strftime('%H:%M'),
                        'is_leave': shift.ist_abwesenheit,
                    })

            Leave = request.env['hr.leave'].sudo()
            leaves = Leave.search([
                ('state', '=', 'validate'),
                ('date_from', '<=', dt_end),
                ('date_to', '>=', dt_start),
                ('employee_id', '=', employee.id),
            ])

            for leave in leaves:
                start = max(leave.date_from.date(), monday)
                end = min(leave.date_to.date(), sunday)
                cur = start
                while cur <= end:
                    day_idx = (cur - monday).days
                    if 0 <= day_idx <= 6:
                        leaves_data.append({
                            'day_idx': day_idx,
                            'code': _('OFF'),
                            'color': '#95a5a6',
                        })
                    cur += timedelta(days=1)

        # Build per-day schedule
        days_schedule = []
        day_names = [_('Monday'), _('Tuesday'), _('Wednesday'),
                     _('Thursday'), _('Friday'), _('Saturday'),
                     _('Sunday')]
        for i in range(7):
            d = monday + timedelta(days=i)
            day_shifts = [s for s in shifts_data if s['day_idx'] == i]
            day_leaves = [l for l in leaves_data if l['day_idx'] == i]
            days_schedule.append({
                'name': day_names[i],
                'date': d,
                'is_today': d == today,
                'shifts': day_shifts,
                'leaves': day_leaves,
            })

        values = {
            'employee': employee,
            'employee_name': employee.name if employee else _('Unknown'),
            'days_schedule': days_schedule,
            'monday': monday,
            'sunday': sunday,
            'kw': monday.isocalendar()[1],
            'today': today,
            'offset': offset_int,
            'user_lang_short': (request.env.lang or 'en_US').split('_')[0],
            'lbl_title': _('My Schedule'),
            'lbl_cw': _('CW'),
            'lbl_no_shifts': _('No shifts this day'),
            'lbl_no_employee': _('No employee record linked to your account. Please contact your manager.'),
            'lbl_off': _('Day off'),
        }
        return request.render('dienstplan_lager.my_schedule_template', values)


# ---------------------------------------------------------------------------
# TV-Kiosk – token-protected public route (GDPR-safe)
# ---------------------------------------------------------------------------
class DienstplanKiosk(http.Controller):
    """Public-facing TV kiosk page.

    Privacy / GDPR
    --------------
    The kiosk URL is accessible without a user login so that it can be
    displayed on a passive screen (TV, monitor) on the shop floor. To prevent
    accidental exposure of employee data on the public internet the route
    is protected by an access token that an administrator must set in
    System Parameters under the key ``dienstplan_lager.kiosk_token``.

    The kiosk shows only:
      * employee name (necessary for shift assignment)
      * area code & published shift times
      * a generic "Absence" placeholder for approved leaves (NOT the
        leave reason / holiday type)
    """

    @http.route(
        '/dienstplan/kiosk',
        type='http',
        auth='public',
        website=False,
        csrf=False,
        sitemap=False,
    )
    def kiosk(self, offset='0', token=None, **kwargs):
        configured_token = _kiosk_token()
        if not configured_token:
            return request.render(
                'dienstplan_lager.kiosk_disabled_template', {})

        # Constant-time comparison to defeat timing attacks
        if not token or not hmac.compare_digest(
                str(token), str(configured_token)):
            return request.render(
                'dienstplan_lager.kiosk_unauthorized_template', {})

        try:
            offset_int = int(offset)
        except (TypeError, ValueError):
            offset_int = 0

        today, monday, sunday, dt_start, dt_end = _week_bounds(offset_int)

        Schicht = request.env['dienstplan.schicht'].sudo()
        shifts = Schicht.search([
            ('datum_von', '>=', dt_start),
            ('datum_von', '<=', dt_end),
            ('state', '=', 'published'),
        ], order='employee_id, datum_von')

        Leave = request.env['hr.leave'].sudo()
        leaves = Leave.search([
            ('state', '=', 'validate'),
            ('date_from', '<=', dt_end),
            ('date_to', '>=', dt_start),
        ])

        employee_ids = (set(shifts.mapped('employee_id.id'))
                        | set(leaves.mapped('employee_id.id')))
        employees = request.env['hr.employee'].sudo().browse(
            list(employee_ids)).sorted('name')

        grid = {}
        for emp in employees:
            grid[emp.id] = {
                'name': emp.name,
                'days': {i: [] for i in range(7)},
            }

        for shift in shifts:
            day_idx = (shift.datum_von.date() - monday).days
            if 0 <= day_idx <= 6:
                grid[shift.employee_id.id]['days'][day_idx].append({
                    'bereich': shift.bereich_id.name,
                    'code': shift.bereich_id.code or shift.bereich_id.name,
                    'color': shift.bereich_id.html_color or '#3498db',
                    'von': shift.datum_von.strftime('%H:%M'),
                    'bis': shift.datum_bis.strftime('%H:%M'),
                    'is_leave': shift.ist_abwesenheit,
                })

        # Generic absence label – NEVER the holiday_status name
        absence_label = _('Absent')
        for leave in leaves:
            emp_id = leave.employee_id.id
            if emp_id not in grid:
                continue
            start = max(leave.date_from.date(), monday)
            end = min(leave.date_to.date(), sunday)
            cur = start
            while cur <= end:
                day_idx = (cur - monday).days
                if 0 <= day_idx <= 6:
                    grid[emp_id]['days'][day_idx].append({
                        'bereich': absence_label,
                        'code': _('OFF'),
                        'color': '#95a5a6',
                        'von': '',
                        'bis': '',
                        'is_leave': True,
                    })
                cur += timedelta(days=1)

        day_names = [_('Monday'), _('Tuesday'), _('Wednesday'), _('Thursday'),
                     _('Friday'), _('Saturday'), _('Sunday')]
        days = [monday + timedelta(days=i) for i in range(7)]

        values = {
            'grid': grid,
            'days': days,
            'day_names': day_names,
            'monday': monday,
            'sunday': sunday,
            'kw': monday.isocalendar()[1],
            'jahr': monday.year,
            'now': datetime.now(),
            'today': today,
            'offset': offset_int,
            'token': token,
            'is_authenticated': bool(request.session.uid),
            'user_lang_short': (request.env.lang or 'en_US').split('_')[0],
            'lbl_title': _('Shift Planning'),
            'lbl_cw': _('CW'),
            'lbl_employee': _('Employee'),
            'lbl_no_data': _('No published shift plan for this week.'),
            'lbl_footer': _('Auto-refresh every 5 min · Last updated:'),
        }
        return request.render('dienstplan_lager.kiosk_template', values)