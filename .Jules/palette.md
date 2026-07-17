# Palette's Journal - Critical Learnings Only

This journal contains only critical UX and accessibility learnings. Routine updates are not logged.

## 2026-03-31 - [SDK Screen Download HTML Accessibility Improvements]

**Learning:** Stitch-generated screens can contain interactive elements (like buttons/links) with visual titles but lacking `aria-label` for screen readers, and inner decorative SVG icons without `aria-hidden`. Post-processing downloaded HTML code programmatically improves screen reader compatibility without altering the original generated source.
**Action:** Automatically map `title` attributes to `aria-label` when missing, and mark inner SVG icons inside labeled containers with `aria-hidden="true"`.

## 2026-04-01 - [Automatic Form Control Accessibility Post-processing]

**Learning:** Stitch-generated screens often download form input, textarea, and select controls without matching accessibility descriptors (like `aria-label`, `aria-labelledby`, or associated `<label>` tag). Programmatically post-processing downloaded HTML code to automatically fallback onto placeholder or title attributes for `aria-label` ensures screen readers can announce form fields properly.
**Action:** Check if the form control has any accessible names (using ID matching on labels, checking parent labels, or existing aria-label attributes); if not, safely populate `aria-label` using the `placeholder` or `title` values. Ensure `<html>` is marked with a default `lang="en"` if missing.
