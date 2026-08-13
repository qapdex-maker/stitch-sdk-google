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

// Hoisted regular expressions to avoid recompilation and allocation inside hot paths
const IPV4_CANDIDATE_PATTERN = /^[0-9.]+$/;
const BRACKET_CLEAN_PATTERN = /^\[|\]$/g;
const IPV6_LOOPBACK_PATTERN = /^0*1$/;

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
    let lowerHost = host.toLowerCase();
    // Normalize by stripping a single trailing dot if present to prevent SSRF trailing-dot bypasses
    if (lowerHost.endsWith(".")) {
      lowerHost = lowerHost.slice(0, -1);
    }

    if (
      lowerHost === "localhost" ||
      lowerHost === "metadata" ||
      lowerHost === "metadata.google.internal"
    ) {
      return false;
    }

    // Check reserved suffixes and local/residential DNS suffixes
    if (
      lowerHost.endsWith(".local") ||
      lowerHost.endsWith(".internal") ||
      lowerHost.endsWith(".localhost") ||
      lowerHost.endsWith(".test") ||
      lowerHost.endsWith(".invalid") ||
      lowerHost.endsWith(".example") ||
      lowerHost.endsWith(".lan") ||
      lowerHost.endsWith(".localdomain") ||
      lowerHost.endsWith(".home") ||
      lowerHost.endsWith(".corp") ||
      lowerHost.endsWith(".home.arpa")
    ) {
      return false;
    }

    // Check IPv4 address (using normalized lowerHost to handle trailing dot)
    if (IPV4_CANDIDATE_PATTERN.test(lowerHost)) {
      const parts = lowerHost.split(".");
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
      const clean = lowerHost.replace(BRACKET_CLEAN_PATTERN, "");
      if (
        clean === "::1" ||
        clean === "::" ||
        IPV6_LOOPBACK_PATTERN.test(clean.replace(COLON_PATTERN, ""))
      ) {
        return false;
      }

      // Dynamically validate the first 16-bit block of IPv6 addresses for Link-Local, Site-Local, and ULA ranges.
      // - ULA (Unique Local Address): fc00::/7 (hex 0xfc00 to 0xfdff)
      // - Link-Local/Site-Local Unicast: fe80::/10 (hex 0xfe80 to 0xfebf), or traditionally fe80::/9 (hex 0xfe80 to 0xfeff)
      const firstColon = clean.indexOf(":");
      if (firstColon !== -1) {
        const firstSegment = clean.substring(0, firstColon);
        if (firstSegment) {
          const firstBlockNum = parseInt(firstSegment, 16);
          if (!isNaN(firstBlockNum)) {
            // Check ULA: fc00::/7 (0xfc00 to 0xfdff)
            if (firstBlockNum >= 0xfc00 && firstBlockNum <= 0xfdff) {
              return false;
            }
            // Check Link-Local/Site-Local: fe80::/9 (0xfe80 to 0xfeff)
            if (firstBlockNum >= 0xfe80 && firstBlockNum <= 0xfeff) {
              return false;
            }
          }
        }
      }

      if (
        clean.startsWith("fe80:") ||
        clean.startsWith("fc00:") ||
        clean.startsWith("fd00:")
      ) {
        return false;
      }

      // Check IPv4-mapped and IPv4-compatible IPv6 addresses for SSRF bypass
      let mappedIpParts: number[] | undefined;
      const ffffIndex = clean.indexOf("ffff:");
      if (ffffIndex !== -1) {
        let ipv4Part = clean.substring(ffffIndex + 5);
        while (ipv4Part.startsWith("0:")) {
          ipv4Part = ipv4Part.substring(2);
        }
        mappedIpParts = parseIpv4MappedPart(ipv4Part);
      } else if (clean.startsWith("::")) {
        const ipv4Part = clean.substring(2);
        const colonsCount = (ipv4Part.match(COLON_PATTERN) || []).length;
        if (colonsCount <= 1) {
          mappedIpParts = parseIpv4MappedPart(ipv4Part);
        }
      }

      if (mappedIpParts) {
        const [o1, o2, o3, o4] = mappedIpParts;
        if (
          o1 === 127 || // Loopback
          o1 === 10 || // Private 10.0.0.0/8
          (o1 === 172 && o2 >= 16 && o2 <= 31) || // Private 172.16.0.0/12
          (o1 === 192 && o2 === 168) || // Private 192.168.0.0/16
          (o1 === 169 && o2 === 254) || // Link-local 169.254.0.0/16
          o1 === 0 // Unspecified/Broadcast
        ) {
          return false;
        }
      }
    }

    return true;
  } catch {
    return false;
  }
}

/**
 * Parses the IPv4 portion of an IPv4-mapped or IPv4-compatible IPv6 address.
 * Handles both dotted-decimal (e.g. "127.0.0.1") and hex-colon (e.g. "7f00:1") representation.
 */
function parseIpv4MappedPart(part: string): number[] | undefined {
  if (part.includes(".")) {
    const parts = part.split(".");
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
        return [o1, o2, o3, o4];
      }
    }
  } else {
    const hexSegments = part.split(":");
    if (hexSegments.length === 2) {
      const high = parseInt(hexSegments[0], 16);
      const low = parseInt(hexSegments[1], 16);
      if (
        !isNaN(high) &&
        !isNaN(low) &&
        high >= 0 &&
        high <= 0xffff &&
        low >= 0 &&
        low <= 0xffff
      ) {
        return [high >> 8, high & 255, low >> 8, low & 255];
      }
    } else if (hexSegments.length === 1) {
      const low = parseInt(hexSegments[0], 16);
      if (!isNaN(low) && low >= 0 && low <= 0xffff) {
        return [0, 0, low >> 8, low & 255];
      }
    }
  }
  return undefined;
}
