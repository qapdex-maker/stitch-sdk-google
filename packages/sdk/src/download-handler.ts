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
import * as crypto from "node:crypto";
import * as cheerio from "cheerio";
import type { AnyNode } from "domhandler";
import type { StitchToolClientSpec } from "./spec/client.js";
import { slugify } from "./slugify.js";
import { DownloadAssetsInputSchema } from "./spec/download.js";
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
      const resolvedTempDir = tempDir ?? outputDir;
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

        const screenDir = path.join(outputDir, screenSlug);
        const screenAssetsDir = path.join(screenDir, safeSubdir);

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

        const html = await fetch(htmlUrl).then((r) => r.text());
        const $ = cheerio.load(html);

        // Ensure all img tags have an alt attribute for accessibility.
        // If an img tag is missing the alt attribute entirely, screen readers will read
        // out the raw filename (which after rewriting is a cryptic hash like "banner-a1b2c3d4.png").
        // Setting an empty alt="" tells screen readers to gracefully ignore decorative images.
        // If there is a title attribute, fallback to title instead of an empty string.
        $("img").each((_, el) => {
          if ($(el).attr("alt") === undefined) {
            const title = $(el).attr("title");
            $(el).attr("alt", title || "");
          }
        });

        // 1. Interactive Elements Accessibility: If a button or link has a `title` attribute
        // but lacks an `aria-label`, populate `aria-label` with the `title` text. This ensures
        // screen readers read a descriptive label instead of silence or cryptic child elements.
        // Also, if the button/link lacks an aria-label and title but has an inner SVG with a <title>,
        // extract it and use it as the aria-label.
        $("button, a").each((_, el) => {
          const title = $(el).attr("title");
          const ariaLabel = $(el).attr("aria-label");
          if (title && !ariaLabel) {
            $(el).attr("aria-label", title);
          } else if (!title && !ariaLabel) {
            const svgTitle = $(el).find("svg title").first().text().trim();
            if (svgTitle) {
              $(el).attr("aria-label", svgTitle);
            }
          }
        });

        // 2. Decorative Icon Accessibility: Mark SVGs inside interactive elements (buttons/links)
        // that already have an accessible label (has an `aria-label` or non-empty text content)
        // with `aria-hidden="true"`. This prevents screen readers from redundantly announcing
        // raw SVG paths or graphics when a meaningful label is already present.
        $("button, a").each((_, parentEl) => {
          const hasLabel =
            $(parentEl).attr("aria-label") ||
            $(parentEl).text().trim().length > 0;
          if (hasLabel) {
            $(parentEl)
              .find("svg")
              .each((_, svgEl) => {
                if ($(svgEl).attr("aria-hidden") === undefined) {
                  $(svgEl).attr("aria-hidden", "true");
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
        $("input, textarea, select").each((_, el) => {
          const type = $(el).attr("type");
          const id = $(el).attr("id");
          const hasAriaLabel = $(el).attr("aria-label") !== undefined;
          const hasAriaLabelledBy = $(el).attr("aria-labelledby") !== undefined;
          const hasLabelAncestor = $(el).closest("label").length > 0;
          const hasForLabel = id ? $(`label[for="${id}"]`).length > 0 : false;

          let hasAccessibleName =
            hasAriaLabel ||
            hasAriaLabelledBy ||
            hasLabelAncestor ||
            hasForLabel;

          if (!hasAccessibleName) {
            // Check for adjacent/preceding unassociated label elements
            if (type === "checkbox" || type === "radio") {
              const nextEl = $(el).next();
              if (nextEl.is("label") && !nextEl.attr("for")) {
                const uniqueId = id || `auto-label-control-${labelCounter++}`;
                if (!id) $(el).attr("id", uniqueId);
                nextEl.attr("for", uniqueId);
                hasAccessibleName = true;
              }
            } else {
              const prevEl = $(el).prev();
              if (prevEl.is("label") && !prevEl.attr("for")) {
                const uniqueId = id || `auto-label-control-${labelCounter++}`;
                if (!id) $(el).attr("id", uniqueId);
                prevEl.attr("for", uniqueId);
                hasAccessibleName = true;
              }
            }
          }

          if (!hasAccessibleName) {
            const placeholder = $(el).attr("placeholder");
            const title = $(el).attr("title");
            const fallbackLabel = placeholder || title;
            if (fallbackLabel) {
              $(el).attr("aria-label", fallbackLabel);
            }
          }

          // 3b. Required Field Accessibility: If a form control has visual cues indicating it is required
          // (e.g. an asterisk or "required" text in the label, placeholder, or title) but lacks semantic markers,
          // programmatically add aria-required="true".
          const isRequired = $(el).attr("required") !== undefined;
          const isAriaRequired = $(el).attr("aria-required") === "true";

          if (!isRequired && !isAriaRequired) {
            let labelText = "";
            const currentId = $(el).attr("id");
            const parentLabel = $(el).closest("label");
            if (parentLabel.length > 0) {
              labelText = parentLabel.text();
            } else if (currentId) {
              labelText = $(`label[for="${currentId}"]`).text();
            }

            const placeholder = $(el).attr("placeholder") || "";
            const title = $(el).attr("title") || "";

            const hasRequiredIndicator = (text: string) => {
              const cleaned = text.trim();
              return cleaned.includes("*") || /\brequired\b/i.test(cleaned);
            };

            if (
              hasRequiredIndicator(labelText) ||
              hasRequiredIndicator(placeholder) ||
              hasRequiredIndicator(title)
            ) {
              $(el).attr("aria-required", "true");
            }
          }
        });

        // 4. Document Language Accessibility: Ensure the <html> element has a lang attribute (defaults to "en").
        const htmlEl = $("html");
        if (htmlEl.length > 0 && !htmlEl.attr("lang")) {
          htmlEl.attr("lang", "en");
        }

        // 5. Links Opening in New Tabs (Accessibility & Security): Ensure links with target="_blank"
        // have safe security attributes (noopener and noreferrer) and explicitly announce to screen reader
        // users that they open in a new tab/window by appending " (opens in a new tab)" to the aria-label.
        $('a[target="_blank"]').each((_, el) => {
          // Security: set rel="noopener noreferrer" safely
          const currentRel = $(el).attr("rel") || "";
          const relParts = currentRel.split(/\s+/).filter(Boolean);
          if (!relParts.includes("noopener")) relParts.push("noopener");
          if (!relParts.includes("noreferrer")) relParts.push("noreferrer");
          $(el).attr("rel", relParts.join(" "));

          // Accessibility: append " (opens in a new tab)" to aria-label if we have some accessible name
          let accessibleName =
            $(el).attr("aria-label") ||
            $(el).attr("title") ||
            $(el).text().trim();
          if (accessibleName) {
            const warningText = "(opens in a new tab)";
            if (!accessibleName.includes(warningText)) {
              const currentAriaLabel = $(el).attr("aria-label");
              if (currentAriaLabel) {
                $(el).attr("aria-label", `${currentAriaLabel} ${warningText}`);
              } else {
                $(el).attr("aria-label", `${accessibleName} ${warningText}`);
              }
            }
          }
        });

        const assetTasks: (() => Promise<void>)[] = [];

        $("img").each((_, el) => {
          const src = $(el).attr("src");
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

        $('link[rel="stylesheet"]').each((_, el) => {
          const href = $(el).attr("href");
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
                .replace(/[^a-z0-9]+/g, "_")
                .replace(/^_+|_+$/g, "")
            : ds.name.split("/").pop();

          const dsDir = path.join(outputDir, dsName);
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
    const fullPath = path.join(assetsDir, filename);
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
  const allowedChars =
    "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_-";
  return base
    .split("")
    .filter((c) => allowedChars.includes(c))
    .join("");
}
