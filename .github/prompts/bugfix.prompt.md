Investigate this bug conservatively.

Approach:
1. Identify likely root causes.
2. Check whether the bug is in domain assumptions, engine logic, UI wiring, or persistence.
3. Prefer the smallest correct fix.
4. Add regression tests.
5. Do not refactor unrelated code unless necessary to fix the issue safely.

When the bug involves medication timing:
- verify exact timestamps
- check interval math
- check PRN lockout logic
- check taper boundary behavior
- check reminder offset calculations