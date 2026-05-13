# -*- coding: utf-8 -*-
"""Shared utilities for the dienstplan_lager module."""
import re

# Strict hex color validation – defends against CSS / style injection
# in templates that embed html_color values as inline styles.
HEX_COLOR_RE = re.compile(r'^#[0-9A-Fa-f]{3}([0-9A-Fa-f]{3})?$')
