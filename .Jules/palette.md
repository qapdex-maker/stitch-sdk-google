# Palette's Journal - Critical Learnings Only

This journal contains only critical UX and accessibility learnings. Routine updates are not logged.

## 2026-03-31 - [SDK Screen Download HTML Accessibility Improvements]

**Learning:** Stitch-generated screens can contain interactive elements (like buttons/links) with visual titles but lacking `aria-label` for screen readers, and inner decorative SVG icons without `aria-hidden`. Post-processing downloaded HTML code programmatically improves screen reader compatibility without altering the original generated source.
**Action:** Automatically map `title` attributes to `aria-label` when missing, and mark inner SVG icons inside labeled containers with `aria-hidden="true"`.
