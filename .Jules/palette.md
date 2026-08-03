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

## 2026-04-04 - [Mapping Visual Form Indicators to Semantic ARIA Required State]

**Learning:** Stitch-generated screen forms frequently convey field requirements via visual-only cues, such as asterisks `*` or `(required)` texts within their associated labels, placeholders, titles, or aria-labels. Screen reader users miss this crucial context if these visual cues do not have associated semantic attributes.
**Action:** Programmatically parse labels, placeholders, titles, and existing aria-labels for asterisks or the word "required", and dynamically apply `aria-required="true"` to the corresponding form input, textarea, and select elements if they lack native or ARIA required states.

## 2026-04-05 - [Keyboard Accessibility and Event Execution on Custom Clickable Elements]

**Learning:** Non-interactive elements (like `div`, `span`, `i`, `p`) having `onclick` attributes are keyboard-focusable and recognized by screen readers when given `role="button"` and `tabindex="0"`, but they cannot be activated via standard keyboard navigation (using the Enter or Space key) without explicit keyboard event listeners. To comply with WCAG 2.1.1 (Keyboard), we must programmatically bind keydown events to automatically trigger the `click()` event on these elements.
**Action:** Post-process downloaded screen HTML code to automatically append a standard `onkeydown` attribute to non-interactive elements with `onclick` attributes that activates click handlers on Enter or Space key press when they are keyboard-focused.

## 2026-04-06 - [Semantic Active Navigation Mapping for Downloaded Screens]

**Learning:** Downloaded or dynamically-generated prototypes and screens frequently denote visual active or current navigation link states purely through CSS styling (e.g., classes matching "active", "current", or "selected"). Without explicit semantic markers, non-visual users are completely unaware which link or tab represents the currently active section or page.
**Action:** Programmatically scan all anchors in post-processing, and if active class indicators are detected on either the link itself or its parent (matching boundary-checked words 'active', 'current', or 'selected'), and `aria-current` is missing, inject `aria-current="page"` to cleanly convey this navigational context to assistive technologies.

## 2026-04-07 - [Automatic Search Landmark Association for Enhanced Page Navigation]

**Learning:** Search elements and sections are critical landmarks for keyboard and screen-reader navigation. If a search input exists but its parent container (form, div, or section) lacks a semantic role, screen reader users cannot quickly jump to or identify the search landmark, forcing them to exhaustively scan the entire page.
**Action:** Programmatically scan all inputs, and if a search input is detected (by checking type, id, name, placeholder, title, or aria-label for 'search'), find its closest form, div, or section container. If the container lacks a `role` attribute, inject `role="search"` to establish an accessible search landmark.

## 2026-04-08 - [Automatic Autocomplete Mapping for Cognitive and Motor Accessibility]

**Learning:** Forms in downloaded or generated screens frequently collect sensitive personal or account information (like name, email, phone, zip, country, and credentials) but completely lack semantic `autocomplete` attributes. This forces users, particularly those with physical, motor, or cognitive disabilities, to exhaustively re-type their information and limits browsers' ability to provide safe, reliable autofill (WCAG 2.1 1.3.5 - Identify Input Purpose).
**Action:** Programmatically inspect form input and textarea elements, scan their types, ids, names, placeholders, titles, and connected labels for purpose-conveying text, and automatically assign the correct standard `autocomplete` identifier if missing.

## 2026-04-09 - [Semantic Disabled State Mapping and Tailwind Modifier Isolation]

**Learning:** When downloaded or dynamically-generated prototypes and screens contain disabled interactive elements (native or custom with class names matching "disabled"), they frequently lack semantic `aria-disabled="true"` markers. When mapping these programmatically, a naive regex check on classes can false-match active Tailwind modifiers (like `disabled:opacity-50` on fully active buttons).
**Action:** Programmatically inspect class attributes by splitting them on whitespace, ignoring any class names containing a colon separator (to exclude active CSS modifiers), and applying `aria-disabled="true"` to valid disabled elements. For custom elements with `onclick`, ensure their `tabindex` is set to `"-1"` and skip adding keydown click handlers.

## 2026-04-10 - [Collapsible Accordion and Dropdown Trigger Mapping]

**Learning:** Stitch-generated prototypes and dynamic screens frequently use collapsible accordion cards, dropdown menus, and mobile hamburger buttons that lack crucial `aria-expanded` or `aria-haspopup` attributes, leaving screen reader users unaware of the elements' collapsible/toggle states. Modifying the DOM structure by injecting visual/physical Skip Links violates CSP policies and SSR/SSG hydration boundaries, but metadata-only enrichment of existing triggers is completely safe and robust.
**Action:** Post-process downloaded HTML by scanning interactive triggers (buttons, anchors, elements with custom roles/onclick handlers) for toggle/accordion/dropdown-conveying classes or labels, and cleanly apply non-intrusive default attributes `aria-expanded="false"` and `aria-haspopup="true"` without altering layout flow or violating strict security headers.

## 2026-04-11 - [Close and Dismiss Trigger Accessibility Enrichment]

**Learning:** Visual-only symbols such as "X", "x", "×", or "✗" used as close or dismiss triggers are announced literally by screen readers (e.g., "ex", "multiply"), which degrades navigation context. Checking visual symbols, text contents, and class/ID names allows us to programmatically enrich these triggers with a semantic `aria-label="Close"`, preserving any pre-existing custom labels.
**Action:** Automatically enrich buttons, links, or custom interactive triggers with `aria-label="Close"` in post-processing when identified as close/dismiss elements and lacking a meaningful, non-symbol accessibility descriptor.
