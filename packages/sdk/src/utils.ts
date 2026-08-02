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
 * Parse a Google API resource name into a bare ID.
 *
 * Google API resource names follow the pattern `{collection}/{id}/{collection}/{id}`.
 * This utility extracts the last segment (the bare ID) from any resource name.
 *
 * @example
 * parseResourceName("projects/123/screens/abc") // → "abc"
 * parseResourceName("projects/123")             // → "123"
 * parseResourceName("abc123")                   // → "abc123" (pass-through)
 */
export function parseResourceName(name: string): string {
  if (!name) return name;
  const lastSlashIndex = name.lastIndexOf("/");
  if (lastSlashIndex === -1) return name;
  return name.substring(lastSlashIndex + 1);
}

/**
 * Validates whether a URL is safe from SSRF attacks (Server-Side Request Forgery).
 * Rejects requests to loopback addresses, private IP ranges, link-local addresses,
 * or typical local/internal hostnames and DNS suffixes.
 */
export function isSafeUrl(urlStr: string): boolean {
  try {
    const url = new URL(urlStr);

    // Only allow HTTP and HTTPS protocols
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return false;
    }

    const host = url.hostname;
    if (!host) {
      return false;
    }

    // Check hostnames (case-insensitive)
    const lowerHost = host.toLowerCase();
    if (
      lowerHost === "localhost" ||
      lowerHost === "metadata" ||
      lowerHost === "metadata.google.internal"
    ) {
      return false;
    }

    // Check reserved suffixes
    if (
      lowerHost.endsWith(".local") ||
      lowerHost.endsWith(".internal") ||
      lowerHost.endsWith(".localhost") ||
      lowerHost.endsWith(".test") ||
      lowerHost.endsWith(".invalid") ||
      lowerHost.endsWith(".example")
    ) {
      return false;
    }

    // Check IPv4 address
    if (/^[0-9.]+$/.test(host)) {
      const parts = host.split(".");
      if (parts.length === 4) {
        const o1 = parseInt(parts[0], 10);
        const o2 = parseInt(parts[1], 10);
        const o3 = parseInt(parts[2], 10);
        const o4 = parseInt(parts[3], 10);
        if (
          !isNaN(o1) &&
          !isNaN(o2) &&
          !isNaN(o3) &&
          !isNaN(o4) &&
          o1 >= 0 &&
          o1 <= 255 &&
          o2 >= 0 &&
          o2 <= 255 &&
          o3 >= 0 &&
          o3 <= 255 &&
          o4 >= 0 &&
          o4 <= 255
        ) {
          // Loopback: 127.0.0.0/8
          if (o1 === 127) return false;
          // Private range: 10.0.0.0/8
          if (o1 === 10) return false;
          // Private range: 172.16.0.0/12
          if (o1 === 172 && o2 >= 16 && o2 <= 31) return false;
          // Private range: 192.168.0.0/16
          if (o1 === 192 && o2 === 168) return false;
          // Link-local: 169.254.0.0/16
          if (o1 === 169 && o2 === 254) return false;
          // Unspecified/Broadcast: 0.0.0.0/8
          if (o1 === 0) return false;
        }
      }
    }

    // Check IPv6 address
    if (host.startsWith("[") && host.endsWith("]")) {
      const clean = lowerHost.replace(/^\[|\]$/g, "");
      if (
        clean === "::1" ||
        clean === "::" ||
        /^0*1$/.test(clean.replace(/:/g, ""))
      ) {
        return false;
      }
      if (
        clean.startsWith("fe80:") ||
        clean.startsWith("fc00:") ||
        clean.startsWith("fd00:")
      ) {
        return false;
      }
    }

    return true;
  } catch {
    return false;
  }
}
