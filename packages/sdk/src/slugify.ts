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

/**
 * Generate a filesystem-safe slug from a screen title.
 *
 * - Lowercases and strips non-alphanumeric characters.
 * - Falls back to screenId when title is empty/undefined.
 * - Appends a numeric suffix on collision within the same `seen` set.
 *
 * @param title - Screen title (may be undefined).
 * @param screenId - Fallback identifier.
 * @param seen - Mutable set tracking slugs already used in this batch.
 * @returns A unique, filesystem-safe slug.
 */
const NON_ALPHANUM_PATTERN = /[^a-z0-9]+/g;
const SURROUNDING_UNDERSCORE_PATTERN = /^_+|_+$/g;

export function slugify(
  title: string | undefined,
  screenId: string,
  seen: Set<string>,
): string {
  const base = title
    ? title
        .toLowerCase()
        .replace(NON_ALPHANUM_PATTERN, "_")
        .replace(SURROUNDING_UNDERSCORE_PATTERN, "")
    : "";

  const baseSlug = base || screenId;
  let slug = baseSlug;
  let counter = 1;
  while (seen.has(slug)) {
    slug = `${baseSlug}_${counter++}`;
  }
  seen.add(slug);
  return slug;
}
