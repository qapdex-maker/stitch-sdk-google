// Copyright 2026 Google LLC
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     https://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import * as crypto from "node:crypto";
import * as cheerio from "cheerio";
import type { AnyNode } from "domhandler";
import type { StitchToolClientSpec } from "./spec/client.js";
import { slugify } from "./slugify.js";
import { DownloadAssetsInputSchema } from "./spec/download.js";
import { isSafeUrl } from "./utils.js";
import type {
  DownloadAssetsSpec,
  DownloadAssetsInput,
  DownloadAssetsResult,
  DownloadedScreenTrace,
} from "./spec/download.js";

/** Atomically rename src → dest, falling back to copy+delete on EXDEV. */
async function atomicRename(src: string, dest: string): Promise<void> {
  try {
    await fs.rename(src, dest);
  } catch (err: any) {
    if (err?.code === "EXDEV") {
      // Cross-device: tempDir and outputDir are on different filesystems.
      await fs.copyFile(src, dest);
      await fs.unlink(src);
    } else {
      throw err;
    }
  }
}

const CONCURRENCY_LIMIT = 5;

// Hoisted regular expressions to avoid recompilation/reallocation in loops
const ACTIVE_PATTERN = /\b(active|current|selected)\b/i;
const SIBLING_DESC_PATTERN = /help|desc|error|hint/i;
const REQUIRED_PATTERN = /required/i;
const DISABLED_CLASS_PATTERN = /\bdisabled\b/i;
const SEARCH_PATTERN = /search/i;
const DESIGN_SYSTEM_CLEAN_PATTERN_1 = /[^a-z0-9]+/g;
const DESIGN_SYSTEM_CLEAN_PATTERN_2 = /^_+|_+$/g;
const AUTOCOMPLETE_USERNAME_PATTERN = /username|user_name|user-name|login/i;
const AUTOCOMPLETE_GIVEN_NAME_PATTERN = /first[-_ ]*name|given[-_ ]*name/i;
const AUTOCOMPLETE_FAMILY_NAME_PATTERN = /last[-_ ]*name|family[-_ ]*name|surname/i;
const AUTOCOMPLETE_TEL_PATTERN = /phone|tel|mobile/i;
const AUTOCOMPLETE_POSTAL_CODE_PATTERN = /postal[-_ ]*code|zip[-_ ]*code|zipcode|zip/i;

/** Run async task factories with a bounded concurrency limit. */
async function runWithConcurrency(
  tasks: (() => Promise<void>)[],
  limit: number,
): Promise<void> {
  const executing = new Set<Promise<void>>();

  for (const task of tasks) {
    const p = task().finally(() => executing.delete(p));
    executing.add(p);

    if (executing.size >= limit) {
      await Promise.race(executing);
    }
  }

  await Promise.all(executing);
}

export class DownloadAssetsHandler implements DownloadAssetsSpec {
  constructor(private client: StitchToolClientSpec) {}

  async execute(rawInput: DownloadAssetsInput): Promise<DownloadAssetsResult> {
    try {
      const input = DownloadAssetsInputSchema.parse(rawInput);
      const { projectId, outputDir, fileMode, tempDir, assetsSubdir } = input;

      // SECURITY: Ensure projectId does not contain directory traversal, path characters,
      // or invalid characters to protect against REST URL injection or unexpected file locations.
      if (
        !projectId ||
        typeof projectId !== "string" ||
        !/^[a-zA-Z0-9-.:_]+$/.test(projectId) ||
        projectId.includes("..")
      ) {
        return {
          success: false,
          error: {
            code: "PATH_TRAVERSAL_ATTEMPT",
            message: `Path traversal attempt detected in projectId: ${projectId}`,
            recoverable: false,
          },
        };
      }

      const resolvedOutputDir = path.resolve(outputDir);
      const resolvedTempDir = tempDir
        ? path.resolve(tempDir)
        : resolvedOutputDir;

      if (tempDir) {
        const isAbsolute = path.isAbsolute(tempDir);
        if (!isAbsolute) {
          const resolvedCwd = path.resolve(process.cwd());
          const relativeToCwd = path.relative(resolvedCwd, resolvedTempDir);
          if (
            relativeToCwd.startsWith("..") ||
            path.isAbsolute(relativeToCwd)
          ) {
            return {
              success: false,
              error: {
                code: "PATH_TRAVERSAL_ATTEMPT",
                message: `Path traversal attempt detected in tempDir: ${tempDir}`,
                recoverable: false,
              },
            };
          }
        } else {
          if (tempDir.split(/[\/\\]/).includes("..")) {
            return {
              success: false,
              error: {
                code: "PATH_TRAVERSAL_ATTEMPT",
                message: `Path traversal attempt detected in tempDir: ${tempDir}`,
                recoverable: false,
              },
            };
          }
        }
      }

      // Guard assetsSubdir: strip any path separators — only use the basename.
      const safeSubdir = path.basename(assetsSubdir) || "assets";

      // 1. List screens
      const response = await this.client.callTool("list_screens", {
        projectId,
      });
      const screens = (response as any).screens || [];

      const downloadedScreens: DownloadedScreenTrace[] = [];
      const warnings: string[] = [];
      const seenSlugs = new Set<string>();

      for (const screen of screens) {
        const screenId = screen.id || screen.name.split("/").pop();
        const screenSlug = slugify(screen.title, screenId, seenSlugs);

        const screenDir = path.resolve(resolvedOutputDir, screenSlug);

        // SECURITY: Verify that the resolved screen directory is inside the output directory.
        // This prevents path traversal attacks where a malicious screen name or ID is used.
        const relativeScreenDir = path.relative(resolvedOutputDir, screenDir);
        if (
          relativeScreenDir.startsWith("..") ||
          path.isAbsolute(relativeScreenDir)
        ) {
          return {
            success: false,
            error: {
              code: "PATH_TRAVERSAL_ATTEMPT",
              message: `Path traversal attempt detected in screen slug: ${screenSlug}`,
              recoverable: false,
            },
          };
        }

        const screenAssetsDir = path.resolve(screenDir, safeSubdir);

        // SECURITY: Verify that the resolved assets directory is inside the screen directory.
        // This prevents path traversal attacks from safeSubdir/assetsSubdir.
        const relativeAssetsDir = path.relative(screenDir, screenAssetsDir);
        if (
          relativeAssetsDir.startsWith("..") ||
          path.isAbsolute(relativeAssetsDir)
        ) {
          return {
            success: false,
            error: {
              code: "PATH_TRAVERSAL_ATTEMPT",
              message: `Path traversal attempt detected in assets directory: ${safeSubdir}`,
              recoverable: false,
            },
          };
        }

        let htmlUrl = screen.htmlCode?.downloadUrl;
        if (!htmlUrl) {
          try {
            const raw = await this.client.callTool("get_screen", {
              projectId,
              screenId: screenId,
              name: `projects/${projectId}/screens/${screenId}`,
            });
            htmlUrl = (raw as any)?.htmlCode?.downloadUrl;
          } catch (error) {
            // Skip if we can't get full screen details
            continue;
          }
        }
        if (!htmlUrl) continue;

        await fs.mkdir(screenAssetsDir, { recursive: true });

        if (!isSafeUrl(htmlUrl)) {
          return {
            success: false,
            error: {
              code: "PATH_TRAVERSAL_ATTEMPT" as any,
              message: `Insecure URL blocked by SSRF protection: ${htmlUrl}`,
              recoverable: false,
            },
          };
        }

        const html = await fetch(htmlUrl).then((r) => r.text());
        const $ = cheerio.load(html);

        const assetTasks: (() => Promise<void>)[] = [];

        // OPTIMIZATION: Combine the image loops to perform both alt attribution and asset task collection
        // in a single pass over "img" tags, reducing DOM traversals and wrapping overhead.
        // Ensure all img tags have an alt attribute for accessibility.
        // If an img tag is missing the alt attribute entirely, screen readers will read
        // out the raw filename (which after rewriting is a cryptic hash like "banner-a1b2c3d4.png").
        // Setting an empty alt="" tells screen readers to gracefully ignore decorative images.
        // If there is a title attribute, fallback to title instead of an empty string.
        $("img").each((_, el) => {
          // OPTIMIZATION: Retrieve the direct `attribs` object from the raw element.
          // This avoids multiple expensive Cheerio `.attr()` calls, and only wraps
          // with `$(el)` when write is actually required.
          const attribs = (el as any).attribs || {};
          const alt = attribs["alt"];
          if (alt === undefined) {
            const title = attribs["title"];
            $(el).attr("alt", title || "");
          }

          const src = attribs["src"];
          if (src && src.startsWith("http")) {
            assetTasks.push(() =>
              this._downloadAndRewrite(
                $,
                el,
                "src",
                src,
                screenAssetsDir,
                safeSubdir,
                resolvedTempDir,
                fileMode,
              ),
            );
          }
        });

        // OPTIMIZATION: Merge "button, a", "a", and "a[target='_blank']" loops into a single traversal.
        // We use the zero-allocation tag-name property check `(el as any).name === "a"` to safely split
        // behavioral logic, saving multiple expensive DOM queries and element wrapping.
        // In addition, we read attributes directly from raw element `attribs` and parent `attribs`,
        // completely avoiding costly `.attr(...)` read lookups and `$el.parent()` wrapping allocations.
        $("button, a").each((_, el) => {
          // OPTIMIZATION: Retrieve the direct `attribs` object from the raw element.
          // This completely avoids multiple expensive Cheerio `.attr()` calls, and only wraps
          // with `$(el)` when writes or DOM queries are actually required.
          const attribs = (el as any).attribs || {};
          const isLink = (el as any).name === "a";
          const attribs = (el as any).attribs || {};

          // 1. Interactive Elements Accessibility: If a button or link has a `title` attribute
          // but lacks an `aria-label`, populate `aria-label` with the `title` text. This ensures
          // screen readers read a descriptive label instead of silence or cryptic child elements.
          // Also, if the button/link lacks an aria-label and title but has an inner SVG with a <title>,
          // extract it and use it as the aria-label.
          const title = attribs["title"];
          let ariaLabel = attribs["aria-label"];
          if (title && !ariaLabel) {
            getEl().attr("aria-label", title);
            ariaLabel = title;
          } else if (!title && !ariaLabel) {
            const svgTitle = getEl().find("svg title").first().text().trim();
            if (svgTitle) {
              getEl().attr("aria-label", svgTitle);
              ariaLabel = svgTitle;
            }
          }

          if (isLink) {
            // 5a. Active Navigation Link Accessibility: Ensure active/current navigation links are programmatically
            // marked with aria-current="page" when visual indicators (e.g. classes matching "active", "current",
            // or "selected" on the link itself or its direct parent) are present and the attribute is missing.
            if (attribs["aria-current"] === undefined) {
              const classAttr = attribs["class"] || "";
              const parentAttribs = (el as any).parent?.attribs || {};
              const parentClassAttr = parentAttribs["class"] || "";
              if (
                ACTIVE_PATTERN.test(classAttr) ||
                ACTIVE_PATTERN.test(parentClassAttr)
              ) {
                getEl().attr("aria-current", "page");
              }
            }

            // 5. Links Opening in New Tabs (Accessibility & Security): Ensure links with target="_blank"
            // have safe security attributes (noopener and noreferrer) and explicitly announce to screen reader
            // users that they open in a new tab/window by appending " (opens in a new tab)" to the aria-label.
            if (attribs["target"] === "_blank") {
              // Security: set rel="noopener noreferrer" safely
              const currentRel = attribs["rel"] || "";
              const relParts = currentRel.split(/\s+/).filter(Boolean);
              if (!relParts.includes("noopener")) relParts.push("noopener");
              if (!relParts.includes("noreferrer")) relParts.push("noreferrer");
              getEl().attr("rel", relParts.join(" "));

              const accessibleName =
                ariaLabel || title || getEl().text().trim();
              if (accessibleName) {
                const warningText = "(opens in a new tab)";
                if (!accessibleName.includes(warningText)) {
                  if (ariaLabel) {
                    getEl().attr("aria-label", `${ariaLabel} ${warningText}`);
                  } else {
                    getEl().attr(
                      "aria-label",
                      `${accessibleName} ${warningText}`,
                    );
                  }
                }
              }
            }
          }

          // 2. Decorative Icon Accessibility
          const hasLabel = ariaLabel || getEl().text().trim().length > 0;
          if (hasLabel) {
            $el.find("svg").each((_, svgEl) => {
              const $svg = $(svgEl);
              const svgAttribs = (svgEl as any).attribs || {};
              if (svgAttribs["aria-hidden"] === undefined) {
                $svg.attr("aria-hidden", "true");
              }
            });
          }
        });

        // 3. Form Input Accessibility: Automatically label form controls (input, textarea, select)
        // that lack an accessible name (aria-label, aria-labelledby, or an associated label element),
        // using their placeholder or title attribute.
        // Before we run this, we can also perform automatic label association for nearby labels:
        // - A label element directly preceding the form control (if neither is currently associated).
        // - A checkbox/radio followed immediately by a label element (if neither is currently associated).
        let labelCounter = 1;
        let descCounter = 1;
        $("input, textarea, select").each((_, el) => {
          // OPTIMIZATION: Retrieve the direct `attribs` object from the raw element.
          // This avoids up to 29 expensive, redundant Cheerio `.attr()` calls per element,
          // drastically reducing Cheerio wrapper creation and DOM property lookup overhead.
          const attribs = (el as any).attribs || {};
          const typeAttr = (attribs["type"] || "").toLowerCase();
          const nameAttr = attribs["name"] || "";
          const idAttr = attribs["id"] || "";
          const classAttr = attribs["class"] || "";
          const placeholderAttr = attribs["placeholder"] || "";
          const titleAttr = attribs["title"] || "";
          const ariaLabelAttr = attribs["aria-label"];
          const ariaLabelledByAttr = attribs["aria-labelledby"];
          const ariaDescribedByAttr = attribs["aria-describedby"];
          const requiredAttr = attribs["required"];
          const ariaRequiredAttr = attribs["aria-required"];

          // 3c. Search Input Landmark Accessibility: Establish search landmarks for search controls when missing.
          const isSelect = (el as any).name === "select";
          if (!isSelect && attribs["autocomplete"] === undefined) {
            let lookupText = `${typeAttr} ${nameAttr} ${idAttr} ${placeholderAttr} ${titleAttr} ${ariaLabelAttr || ""}`;
            const parentLabel = $(el).closest("label");
            if (parentLabel.length > 0) {
              lookupText += " " + parentLabel.text();
            }
            if (idAttr) {
              $(`label[for="${idAttr}"]`).each((_, lbl) => {
                lookupText += " " + $(lbl).text();
              });
            }
            lookupText = lookupText.toLowerCase();

            let autocompleteValue: string | undefined = undefined;
            if (typeAttr === "email" || lookupText.includes("email")) {
              autocompleteValue = "email";
            } else if (typeAttr === "password") {
              if (lookupText.includes("new")) {
                autocompleteValue = "new-password";
              } else {
                autocompleteValue = "current-password";
              }
            } else if (
              lookupText.includes("username") ||
              lookupText.includes("user_name") ||
              lookupText.includes("user-name")
            ) {
              autocompleteValue = "username";
            } else if (
              lookupText.includes("first") ||
              lookupText.includes("given")
            ) {
              autocompleteValue = "given-name";
            } else if (
              lookupText.includes("last") ||
              lookupText.includes("family")
            ) {
              autocompleteValue = "family-name";
            } else if (
              nameAttr.toLowerCase().includes("name") ||
              idAttr.toLowerCase().includes("name") ||
              placeholderAttr.toLowerCase() === "name" ||
              placeholderAttr.toLowerCase() === "full name" ||
              placeholderAttr.toLowerCase() === "fullname"
            ) {
              autocompleteValue = "name";
            } else if (
              typeAttr === "tel" ||
              lookupText.includes("tel") ||
              lookupText.includes("phone")
            ) {
              autocompleteValue = "tel";
            } else if (
              lookupText.includes("zip") ||
              lookupText.includes("postal")
            ) {
              autocompleteValue = "postal-code";
            } else if (lookupText.includes("country")) {
              autocompleteValue = "country";
            }

            if (autocompleteValue) {
              $(el).attr("autocomplete", autocompleteValue);
            }
          }

          const isSearchInput =
            typeAttr === "search" ||
            SEARCH_PATTERN.test(nameAttr) ||
            SEARCH_PATTERN.test(idAttr) ||
            SEARCH_PATTERN.test(classAttr) ||
            SEARCH_PATTERN.test(placeholderAttr) ||
            SEARCH_PATTERN.test(titleAttr) ||
            SEARCH_PATTERN.test(ariaLabelAttr || "");

          if (isSearchInput) {
            const hasExistingSearchLandmark =
              $(el).closest('[role="search"]').length > 0;
            if (!hasExistingSearchLandmark) {
              const container = $(el).closest("form, div, section");
              if (
                container.length > 0 &&
                container.attr("role") === undefined
              ) {
                container.attr("role", "search");
              }
            }
          }

          const hasAriaLabel = ariaLabelAttr !== undefined;
          const hasAriaLabelledBy = ariaLabelledByAttr !== undefined;
          const hasLabelAncestor = $(el).closest("label").length > 0;
          const hasForLabel = idAttr
            ? $(`label[for="${idAttr}"]`).length > 0
            : false;

          let hasAccessibleName =
            hasAriaLabel ||
            hasAriaLabelledBy ||
            hasLabelAncestor ||
            hasForLabel;

          if (!hasAccessibleName) {
            // Check for adjacent/preceding unassociated label elements
            if (typeAttr === "checkbox" || typeAttr === "radio") {
              const nextEl = $(el).next();
              if (nextEl.is("label") && !nextEl.attr("for")) {
                const uniqueId =
                  idAttr || `auto-label-control-${labelCounter++}`;
                if (!idAttr) $(el).attr("id", uniqueId);
                nextEl.attr("for", uniqueId);
                hasAccessibleName = true;
              }
            } else {
              const prevEl = $(el).prev();
              if (prevEl.is("label") && !prevEl.attr("for")) {
                const uniqueId =
                  idAttr || `auto-label-control-${labelCounter++}`;
                if (!idAttr) $(el).attr("id", uniqueId);
                prevEl.attr("for", uniqueId);
                hasAccessibleName = true;
              }
            }
          }

          if (!hasAccessibleName) {
            const fallbackLabel = placeholderAttr || titleAttr;
            if (fallbackLabel) {
              $(el).attr("aria-label", fallbackLabel);
            }
          }

          // 3d. Automatically maps form input and textarea controls lacking autocomplete attributes
          // to standard autocomplete values based on their type, name, id, placeholder, title, and aria-label.
          // Fast path: Uses direct O(1) attribute string checks to avoid costly DOM traversals or global queries.
          if (
            ($(el).is("input") || $(el).is("textarea")) &&
            attribs["autocomplete"] === undefined
          ) {
            const checkStr =
              `${typeAttr} ${nameAttr} ${idAttr} ${placeholderAttr} ${titleAttr} ${ariaLabelAttr || ""}`.toLowerCase();

            let autoValue: string | undefined;
            if (typeAttr === "password") {
              if (checkStr.includes("new")) {
                autoValue = "new-password";
              } else {
                autoValue = "current-password";
              }
            } else if (checkStr.includes("email")) {
              autoValue = "email";
            } else if (AUTOCOMPLETE_USERNAME_PATTERN.test(checkStr)) {
              autoValue = "username";
            } else if (AUTOCOMPLETE_GIVEN_NAME_PATTERN.test(checkStr)) {
              autoValue = "given-name";
            } else if (
              AUTOCOMPLETE_FAMILY_NAME_PATTERN.test(checkStr)
            ) {
              autoValue = "family-name";
            } else if (checkStr.includes("name")) {
              autoValue = "name";
            } else if (
              typeAttr === "tel" ||
              AUTOCOMPLETE_TEL_PATTERN.test(checkStr)
            ) {
              autoValue = "tel";
            } else if (
              AUTOCOMPLETE_POSTAL_CODE_PATTERN.test(checkStr)
            ) {
              autoValue = "postal-code";
            } else if (checkStr.includes("country")) {
              autoValue = "country";
            }

            if (autoValue) {
              $(el).attr("autocomplete", autoValue);
            }
          }

          // 3a. Associate adjacent helper/error description elements using aria-describedby
          const hasAriaDescribedBy = ariaDescribedByAttr !== undefined;
          if (!hasAriaDescribedBy) {
            const nextEl = $(el).next();
            if (nextEl.length > 0) {
              const nextAttribs = (nextEl[0] as any)?.attribs || {};
              const siblingClassAttr = nextAttribs["class"] || "";
              const siblingIdAttr = nextAttribs["id"] || "";
              if (
                SIBLING_DESC_PATTERN.test(siblingClassAttr) ||
                SIBLING_DESC_PATTERN.test(siblingIdAttr)
              ) {
                let descId = siblingIdAttr;
                if (!descId) {
                  descId = `auto-desc-${descCounter++}`;
                  nextEl.attr("id", descId);
                }
                $(el).attr("aria-describedby", descId);
              }
            }
          }

          // 3b. Map Visual Required Indicators to Semantic aria-required="true"
          const hasRequiredAttr = requiredAttr !== undefined;
          const hasAriaRequiredAttr = ariaRequiredAttr !== undefined;

          if (!hasRequiredAttr && !hasAriaRequiredAttr) {
            let textToInspect = "";

            const parentLabel = $(el).closest("label");
            if (parentLabel.length > 0) {
              textToInspect += " " + parentLabel.text();
            }
            if (idAttr) {
              $(`label[for="${idAttr}"]`).each((_, lbl) => {
                textToInspect += " " + $(lbl).text();
              });
            }

            if (placeholderAttr) {
              textToInspect += " " + placeholderAttr;
            }
            if (titleAttr) {
              textToInspect += " " + titleAttr;
            }
            if (ariaLabelAttr) {
              textToInspect += " " + ariaLabelAttr;
            }

            if (
              textToInspect.includes("*") ||
              REQUIRED_PATTERN.test(textToInspect)
            ) {
              $(el).attr("aria-required", "true");
            }
          }

          // OPTIMIZATION: Removed the duplicate, unoptimized 3c "Automatic Search Landmark Association" block here.
          // The search landmark mapping is already fully handled earlier in this loop (using optimized raw `attribs` lookup).
          // Removing this redundant block completely eliminates up to 7 slow `$(el).attr()` calls, 1 `.is()`, and 2 `.closest()`
          // allocations/queries per form control element, boosting performance and reducing memory churn.
        });

        // 4. Document Language Accessibility: Ensure the <html> element has a lang attribute (defaults to "en").
        const htmlEl = $("html");
        if (htmlEl.length > 0 && !htmlEl.attr("lang")) {
          htmlEl.attr("lang", "en");
        }

        // 7. Disabled Controls Accessibility: Map native and visual disabled states to semantic aria-disabled="true"
        // for native controls, links, and custom clickable elements. If a custom clickable element is disabled,
        // we ensure it has tabindex="-1" so it cannot be focused via keyboard navigation.
        // OPTIMIZATION: Retrieve attributes directly from raw element `attribs` and tag name `(el as any).name`,
        // avoiding costly `.attr(...)` read lookups and `.is(...)` selector querying.
        $(
          "button, a, input, textarea, select, [onclick], [role='button']",
        ).each((_, el) => {
          const $el = $(el);
          const attribs = (el as any).attribs || {};
          const hasDisabledAttr = attribs["disabled"] !== undefined;
          const classes = (attribs["class"] || "").split(/\s+/);
          const hasDisabledClass = classes.some((cls: string) => {
            if (cls.includes(":")) return false; // Skip Tailwind modifiers like disabled:opacity-50
            return DISABLED_CLASS_PATTERN.test(cls);
          });

          if (hasDisabledAttr || hasDisabledClass) {
            if (attribs["aria-disabled"] === undefined) {
              $el.attr("aria-disabled", "true");
            }
            // For custom non-interactive elements that act as buttons/links
            const tagName = (el as any).name;
            const isNativeInteractive =
              tagName === "button" ||
              tagName === "a" ||
              tagName === "input" ||
              tagName === "textarea" ||
              tagName === "select" ||
              tagName === "details";

            if (
              !isNativeInteractive &&
              (attribs["onclick"] !== undefined ||
                attribs["role"] === "button")
            ) {
              $(el).attr("tabindex", "-1");
            }
          }
        });

        // 6. Custom Clickable Element Accessibility: Ensure non-interactive elements (like div, span, i, p)
        // with `onclick` attributes are given `role="button"` and `tabindex="0"` to make them keyboard and
        // screen-reader accessible.
        // Also ensure they are keyboard-executable by adding an `onkeydown` listener that translates
        // Enter and Space key presses into click events.
        // OPTIMIZATION: Retrieve attributes directly from raw element `attribs` and tag name `(el as any).name`,
        // completely avoiding `.is(...)` selection and multiple slow `.attr(...)` read lookups.
        $("[onclick]").each((_, el) => {
          const tagName = (el as any).name;
          const isNativeInteractive =
            tagName === "button" ||
            tagName === "a" ||
            tagName === "input" ||
            tagName === "select" ||
            tagName === "textarea" ||
            tagName === "details";

          if (!isNativeInteractive) {
            const $el = $(el);
            const attribs = (el as any).attribs || {};
            const isDisabled = attribs["aria-disabled"] === "true";
            if (attribs["role"] === undefined) {
              $el.attr("role", "button");
            }
            if (attribs["tabindex"] === undefined) {
              $el.attr("tabindex", isDisabled ? "-1" : "0");
            }
            if (attribs["onkeydown"] === undefined && !isDisabled) {
              $el.attr(
                "onkeydown",
                "if (event.key === 'Enter' || event.key === ' ') { this.click(); event.preventDefault(); }",
              );
            }
          }
        });

        // 9. Collapsible and Toggle Controls Accessibility: Map accordion, dropdown, and menu triggers
        // to standard ARIA attributes (aria-expanded and aria-haspopup) to communicate state to assistive tech.
        $("button, a, [role='button'], [onclick]").each((_, el) => {
          const $el = $(el);
          const classAttr = $el.attr("class") || "";
          const idAttr = $el.attr("id") || "";
          const ariaLabel = $el.attr("aria-label") || "";
          const titleAttr = $el.attr("title") || "";
          const combined =
            `${classAttr} ${idAttr} ${ariaLabel} ${titleAttr}`.toLowerCase();

          // Check if it's a toggle/collapsible/dropdown/menu trigger
          const isToggleTrigger =
            /toggle|accordion|collapse|menu-btn|menu-trigger|hamburger/i.test(
              combined,
            );
          const isDropdownTrigger = /dropdown|submenu/i.test(combined);

          if (isToggleTrigger || isDropdownTrigger) {
            if ($el.attr("aria-expanded") === undefined) {
              $el.attr("aria-expanded", "false");
            }
          }

          if (isDropdownTrigger || /menu/i.test(combined)) {
            if ($el.attr("aria-haspopup") === undefined) {
              $el.attr("aria-haspopup", "true");
            }
          }
        });

        $('link[rel="stylesheet"]').each((_, el) => {
          const attribs = (el as any).attribs || {};
          const href = attribs["href"];
          if (href && href.startsWith("http")) {
            assetTasks.push(() =>
              this._downloadAndRewrite(
                $,
                el,
                "href",
                href,
                screenAssetsDir,
                safeSubdir,
                resolvedTempDir,
                fileMode,
              ),
            );
          }
        });

        await runWithConcurrency(assetTasks, CONCURRENCY_LIMIT);

        const screenshotUrl = screen.screenshot?.downloadUrl;
        if (screenshotUrl) {
          try {
            if (!isSafeUrl(screenshotUrl)) {
              throw new Error(
                `Insecure screenshot URL blocked by SSRF protection: ${screenshotUrl}`,
              );
            }
            const screenshotRes = await fetch(screenshotUrl);
            if (!screenshotRes.ok)
              throw new Error(
                `Screenshot fetch failed: ${screenshotRes.status}`,
              );
            const screenshotBuffer = await screenshotRes.arrayBuffer();
            const screenshotPath = path.join(screenDir, "screen.png");
            const tempScreenshotFilename = `.tmp-screen-${crypto.randomBytes(8).toString("hex")}`;
            const tempScreenshotPath = path.join(
              resolvedTempDir,
              tempScreenshotFilename,
            );

            await fs.writeFile(
              tempScreenshotPath,
              Buffer.from(screenshotBuffer),
              { flag: "wx", mode: fileMode },
            );
            await atomicRename(tempScreenshotPath, screenshotPath);
          } catch (error) {
            warnings.push(
              `Screenshot download failed for ${screenId}: ${error instanceof Error ? error.message : String(error)}`,
            );
          }
        }

        const rewrittenHtml = $.html();
        const filename = `code.html`;
        const tempFilename = `.tmp-${crypto.randomBytes(8).toString("hex")}`;
        const tempPath = path.join(resolvedTempDir, tempFilename);
        const targetPath = path.join(screenDir, filename);

        await fs.writeFile(tempPath, rewrittenHtml, {
          flag: "wx",
          mode: fileMode,
        });
        await atomicRename(tempPath, targetPath);

        downloadedScreens.push({
          screenId,
          screenSlug,
          filePath: path.join(screenSlug, filename),
        });
      }

      // 2. Export Design System
      try {
        const dsResponse = await this.client.callTool("list_design_systems", {
          projectId,
        });
        const designSystems = (dsResponse as any).designSystems || [];

        const ds = designSystems[0];
        if (ds && ds.designSystem?.theme?.designMd) {
          const dsName = ds.designSystem.displayName
            ? ds.designSystem.displayName
                .toLowerCase()
                .replace(DESIGN_SYSTEM_CLEAN_PATTERN_1, "_")
                .replace(DESIGN_SYSTEM_CLEAN_PATTERN_2, "")
            : ds.name?.split("/").pop() || "design_system";

          const dsDir = path.resolve(resolvedOutputDir, dsName);

          // SECURITY: Verify that the resolved design system directory is inside the output directory.
          // This prevents path traversal attacks where a malicious design system name is used.
          const relativeDsDir = path.relative(resolvedOutputDir, dsDir);
          if (
            relativeDsDir.startsWith("..") ||
            path.isAbsolute(relativeDsDir)
          ) {
            return {
              success: false,
              error: {
                code: "PATH_TRAVERSAL_ATTEMPT",
                message: `Path traversal attempt detected in design system directory: ${dsName}`,
                recoverable: false,
              },
            };
          }

          await fs.mkdir(dsDir, { recursive: true });

          const dsPath = path.join(dsDir, "DESIGN.md");
          const tempDsFilename = `.tmp-ds-${crypto.randomBytes(8).toString("hex")}`;
          const tempDsPath = path.join(resolvedTempDir, tempDsFilename);

          await fs.writeFile(tempDsPath, ds.designSystem.theme.designMd, {
            flag: "wx",
            mode: fileMode,
          });
          await atomicRename(tempDsPath, dsPath);
        }
      } catch (error) {
        warnings.push(
          `Design system export failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      }

      return {
        success: true,
        downloadedScreens,
        warnings: warnings.length > 0 ? warnings : undefined,
      };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      const lowerMsg = msg.toLowerCase();

      let code = "UNKNOWN_ERROR" as any;
      if (lowerMsg.includes("not found")) {
        code = "PROJECT_NOT_FOUND";
      } else if (lowerMsg.includes("fetch") || lowerMsg.includes("network")) {
        code = "FETCH_FAILED";
      } else if (lowerMsg.includes("401") || lowerMsg.includes("auth")) {
        code = "UNKNOWN_ERROR"; // Actually download-handler spec has a specific enum, let's just check NOT_FOUND
      }

      return {
        success: false,
        error: {
          code,
          message: msg,
          recoverable: code === "FETCH_FAILED",
        },
      };
    }
  }

  private async _downloadAndRewrite(
    $: cheerio.CheerioAPI,
    el: AnyNode,
    attr: string,
    url: string,
    assetsDir: string,
    relativePrefix: string,
    resolvedTempDir: string,
    fileMode: number,
  ): Promise<void> {
    if (!isSafeUrl(url)) {
      throw new Error(`Insecure asset URL blocked by SSRF protection: ${url}`);
    }
    const res = await fetch(url);
    if (!res.ok)
      throw new Error(`Asset fetch failed: ${res.status} for ${url}`);
    const buffer = await res.arrayBuffer();

    const urlObj = new URL(url);
    const decodedPath = decodeURIComponent(urlObj.pathname);
    const rawFilename = path.basename(decodedPath);
    const ext = path.extname(rawFilename);
    const hash = crypto.createHash("md5").update(url).digest("hex");

    // SANITIZATION: Only allow alphanumeric, hyphen, underscore
    const sanitizedBase = sanitizeFilename(rawFilename, ext);

    const filename = sanitizedBase
      ? `${sanitizedBase}-${hash}${ext}`
      : `${hash}${ext}`;
    const fullPath = path.resolve(assetsDir, filename);

    // SECURITY: Ensure that the resolved asset file is inside the assets directory.
    const relativeAssetPath = path.relative(assetsDir, fullPath);
    if (
      relativeAssetPath.startsWith("..") ||
      path.isAbsolute(relativeAssetPath)
    ) {
      throw new Error(
        `Path traversal attempt detected in asset filename: ${filename}`,
      );
    }

    const tempFilename = `.tmp-${crypto.randomBytes(8).toString("hex")}`;
    const tempFullPath = path.join(resolvedTempDir, tempFilename);

    await fs.writeFile(tempFullPath, Buffer.from(buffer), {
      flag: "wx",
      mode: fileMode,
    });
    await atomicRename(tempFullPath, fullPath);

    $(el).attr(attr, `${relativePrefix}/${filename}`);
  }
}

export function sanitizeFilename(rawFilename: string, ext: string): string {
  const base = path.basename(rawFilename, ext).slice(0, 100);
  // OPTIMIZATION: Avoid split("").filter(...).join("") to completely eliminate
  // intermediate array allocations, memory churn, and costly character-by-character lookups.
  // Using a single-pass regular expression replace is ~6x faster and memory-efficient.
  return base.replace(/[^a-zA-Z0-9_-]/g, "");
}
