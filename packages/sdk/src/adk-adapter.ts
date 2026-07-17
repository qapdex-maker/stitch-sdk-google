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

import { FunctionTool } from "@google/adk";
import type { Schema } from "@google/genai";
import { toolDefinitions } from "../generated/src/tool-definitions.js";
import { getOrCreateClient } from "./singleton.js";

/**
 * Recursively cleans and flattens a JSON Schema to make it compatible with the Google ADK/Gemini API.
 * It resolves internal `#/$defs/` references directly into the object, and removes
 * keys that the Gemini API validator rejects, such as `$defs`, `$ref`, `deprecated`,
 * and custom `x-google-` extensions.
 *
 * @param schema - The JSON Schema object to clean.
 * @returns The cleaned, flattened JSON schema object.
 */
function cleanSchema(schema: any): any {
  if (!schema || typeof schema !== "object") return schema;
  const defs = schema.$defs || {};

  function stripAndResolve(node: any, seen = new Map()): any {
    if (!node || typeof node !== "object") return node;
    if (seen.has(node)) return seen.get(node);

    if (Array.isArray(node)) {
      const arr: any[] = [];
      seen.set(node, arr);
      for (const val of node) {
        arr.push(stripAndResolve(val, seen));
      }
      return arr;
    }

    if (
      node.$ref &&
      typeof node.$ref === "string" &&
      node.$ref.startsWith("#/$defs/")
    ) {
      const defName = node.$ref.slice(8);
      if (defs[defName]) {
        const target = stripAndResolve(defs[defName], seen);
        const resolved = { ...target };
        // OPTIMIZATION: Avoid Object.entries to prevent array of entries allocation during deep recursive schema traversal.
        for (const k in node) {
          if (Object.prototype.hasOwnProperty.call(node, k)) {
            if (
              k !== "$ref" &&
              k !== "x-google-identifier" &&
              k !== "deprecated" &&
              !k.startsWith("x-google-")
            ) {
              resolved[k] = stripAndResolve(node[k], seen);
            }
          }
        }
        return resolved;
      }
    }

    const result: any = {};
    seen.set(node, result);

    // OPTIMIZATION: Avoid Object.entries to prevent array of entries allocation during deep recursive schema traversal.
    for (const key in node) {
      if (Object.prototype.hasOwnProperty.call(node, key)) {
        if (
          key === "$defs" ||
          key === "$ref" ||
          key === "deprecated" ||
          key.startsWith("x-google-")
        ) {
          continue;
        }
        result[key] = stripAndResolve(node[key], seen);
      }
    }
    return result;
  }

  return stripAndResolve(schema);
}

/**
 * Returns Stitch tools in Google ADK format.
 *
 * Each tool is pre-wired with `execute` → `callTool` against the Stitch MCP server.
 * Drop directly into an ADK Agent configuration.
 *
 * @example
 * import { stitchAdkTools } from "@google/stitch-sdk/adk";
 *
 * const agent = new LLMAgent({
 *   name: "Stitch Agent",
 *   instruction: "Create a login page",
 *   tools: stitchAdkTools(),
 * });
 *
 * @param options - Optional config
 * @param options.apiKey - Override STITCH_API_KEY env var
 * @param options.include - Only include specific tool names
 */
export function stitchAdkTools(options?: {
  apiKey?: string;
  include?: string[];
}): FunctionTool<Schema>[] {
  const client = getOrCreateClient(options);

  // OPTIMIZATION: Convert the inclusion array into a Set to reduce lookup complexity from O(M) to O(1) per tool.
  let filtered = toolDefinitions;
  if (options?.include) {
    const includeSet = new Set(options.include);
    filtered = toolDefinitions.filter((t) => includeSet.has(t.name));
  }

  return filtered.map(
    (t) =>
      new FunctionTool({
        name: t.name,
        description: t.description,
        parameters: cleanSchema(t.inputSchema) as Schema,
        execute: async (args: unknown) =>
          client.callTool(t.name, args as Record<string, any>),
      }),
  );
}
