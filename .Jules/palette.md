# Palette's Journal - Critical Learnings Only

This journal contains only critical UX and accessibility learnings. Routine updates are not logged.

## 2026-03-31 - [SDK Screen Download HTML Accessibility Improvements]

**Learning:** Stitch-generated screens can contain interactive elements (like buttons/links) with visual titles but lacking `aria-label` for screen readers, and inner decorative SVG icons without `aria-hidden`. Post-processing downloaded HTML code programmatically improves screen reader compatibility without altering the original generated source.
**Action:** Automatically map `title` attributes to `aria-label` when missing, and mark inner SVG icons inside labeled containers with `aria-hidden="true"`.

## 2026-04-01 - [Automatic Form Control Accessibility Post-processing]

**Learning:** Stitch-generated screens often download form input, textarea, and select controls without matching accessibility descriptors (like `aria-label`, `aria-labelledby`, or associated `<label>` tag). Programmatically post-processing downloaded HTML code to automatically fallback onto placeholder or title attributes for `aria-label` ensures screen readers can announce form fields properly.
**Action:** Check if the form control has any accessible names (using ID matching on labels, checking parent labels, or existing aria-label attributes); if not, safely populate `aria-label` using the `placeholder` or `title` values. Ensure `<html>` is marked with a default `lang="en"` if missing.

## 2026-04-02 - [Interactive SVGs and Programmatic Adjacent Label Connectivity]

**Learning:** Dynamic layout engines or AI-generated screens frequently output button/link components containing inner inline SVGs that embed standard SVG `<title>` elements but do not propagate them as visual or screen-reader accessible names. Additionally, many layout generators fail to explicitly couple adjacent `<label>` elements with form inputs via `for` and `id` attributes, resulting in broken mouse-click focus interactions and screen reader context loss.
**Action:** Programmatically parse nested SVG titles to automatically populate `aria-label` on wrapper buttons/links if they have no explicit accessibility descriptors, and dynamically associate preceding/succeeding unassociated `<label>` elements with their adjacent form controls by generating safe unique IDs and adding `id` and `for` attributes.

## 2026-04-03 - [Security and Accessible Tab Announcements for target="_blank" Links]

**Learning:** HTML screens downloaded or generated dynamically may contain links with `target="_blank"`. Without security relations (`noopener` and `noreferrer`), these links expose users to reverse tabnabbing vulnerabilities. Additionally, screen reader users are often unaware when links open in a new tab/window, which can cause confusion and navigation disorientation.
**Action:** Post-process downloaded screen HTML code to ensure all `target="_blank"` links are explicitly tagged with `rel="noopener noreferrer"`. Enhance user accessibility by appending " (opens in a new tab)" to the link's `aria-label` attribute if any accessible name exists, and avoid redundant appends if the warning text is already present.
