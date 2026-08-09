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

import { describe, it, expect } from "vitest";
import { isSafeUrl } from "../../src/utils.js";

describe("isSafeUrl SSRF Protection", () => {
  describe("Allowed URLs", () => {
    it("allows standard public HTTPS URLs", () => {
      expect(isSafeUrl("https://google.com")).toBe(true);
      expect(isSafeUrl("https://github.com/google/stitch-sdk")).toBe(true);
      expect(
        isSafeUrl("https://storage.googleapis.com/stitch-assets/img.png"),
      ).toBe(true);
    });

    it("allows standard public HTTP URLs", () => {
      expect(isSafeUrl("http://example.com")).toBe(true);
      expect(isSafeUrl("http://example.com/logo.png")).toBe(true);
      expect(isSafeUrl("http://cdn.example.com/styles.css")).toBe(true);
    });

    it("allows mock single-label domains used in unit tests", () => {
      expect(isSafeUrl("http://fake/s1.html")).toBe(true);
    });
  });

  describe("Blocked URLs", () => {
    it("rejects non-HTTP/HTTPS protocols", () => {
      expect(isSafeUrl("ftp://google.com")).toBe(false);
      expect(isSafeUrl("file:///etc/passwd")).toBe(false);
      expect(isSafeUrl("gopher://google.com")).toBe(false);
      expect(
        isSafeUrl("data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg=="),
      ).toBe(false);
    });

    it("rejects loopback hostnames and IPs", () => {
      expect(isSafeUrl("http://localhost")).toBe(false);
      expect(isSafeUrl("https://LOCALHOST/abc")).toBe(false);
      expect(isSafeUrl("http://localhost.")).toBe(false);
      expect(isSafeUrl("http://127.0.0.1")).toBe(false);
      expect(isSafeUrl("http://127.0.0.254")).toBe(false);
      expect(isSafeUrl("http://127.10.20.30")).toBe(false);
      expect(isSafeUrl("http://[::1]")).toBe(false);
      expect(isSafeUrl("http://[0:0:0:0:0:0:0:1]")).toBe(false);
    });

    it("rejects private IPv4 ranges", () => {
      expect(isSafeUrl("http://10.0.0.1")).toBe(false);
      expect(isSafeUrl("http://10.255.255.255")).toBe(false);
      expect(isSafeUrl("http://172.16.0.1")).toBe(false);
      expect(isSafeUrl("http://172.31.255.255")).toBe(false);
      expect(isSafeUrl("http://192.168.0.1")).toBe(false);
      expect(isSafeUrl("http://192.168.255.255")).toBe(false);
    });

    it("rejects link-local IPv4 address and metadata ranges", () => {
      expect(isSafeUrl("http://169.254.169.254")).toBe(false);
      expect(isSafeUrl("http://169.254.169.254/computeMetadata/v1/")).toBe(
        false,
      );
      expect(isSafeUrl("http://169.254.1.1")).toBe(false);
    });

    it("rejects broadcast and unspecified IPv4 addresses", () => {
      expect(isSafeUrl("http://0.0.0.0")).toBe(false);
    });

    it("rejects metadata and internal DNS hostnames", () => {
      expect(isSafeUrl("http://metadata")).toBe(false);
      expect(isSafeUrl("http://METADATA")).toBe(false);
      expect(isSafeUrl("http://metadata.google.internal")).toBe(false);
      expect(isSafeUrl("http://metadata.google.internal.")).toBe(false);
      expect(isSafeUrl("http://metadata.google.internal/computeMetadata")).toBe(
        false,
      );
    });

    it("rejects reserved local/internal TLDs and suffixes", () => {
      expect(isSafeUrl("http://service.local")).toBe(false);
      expect(isSafeUrl("http://service.local.")).toBe(false);
      expect(isSafeUrl("http://database.internal")).toBe(false);
      expect(isSafeUrl("http://app.localhost")).toBe(false);
      expect(isSafeUrl("http://web.test")).toBe(false);
      expect(isSafeUrl("http://site.invalid")).toBe(false);
      expect(isSafeUrl("http://api.example")).toBe(false);
    });

    it("rejects unique local and link-local IPv6 addresses", () => {
      expect(isSafeUrl("http://[fe80::1]")).toBe(false);
      expect(isSafeUrl("http://[fc00::1]")).toBe(false);
      expect(isSafeUrl("http://[fd00::1]")).toBe(false);

      // Link-local/ULA subnet range bypasses
      expect(isSafeUrl("http://[fc01::1]")).toBe(false);
      expect(isSafeUrl("http://[fe81::1]")).toBe(false);
      expect(isSafeUrl("http://[fd12:3456:789a:bcde::1]")).toBe(false);
    });

    it("rejects local and residential DNS suffixes", () => {
      expect(isSafeUrl("http://router.lan")).toBe(false);
      expect(isSafeUrl("http://myhost.localdomain")).toBe(false);
      expect(isSafeUrl("http://smarthome.home")).toBe(false);
      expect(isSafeUrl("http://company.corp")).toBe(false);
      expect(isSafeUrl("http://printer.home.arpa")).toBe(false);
    });

    it("rejects IPv4-mapped and IPv4-compatible IPv6 addresses mapping to restricted/private IPs", () => {
      // Loopback
      expect(isSafeUrl("http://[::ffff:127.0.0.1]")).toBe(false);
      expect(isSafeUrl("http://[::ffff:7f00:1]")).toBe(false);
      expect(isSafeUrl("http://[::ffff:0:7f00:1]")).toBe(false);
      expect(isSafeUrl("http://[::7f00:1]")).toBe(false);

      // Metadata / Link-local
      expect(isSafeUrl("http://[::ffff:169.254.169.254]")).toBe(false);
      expect(isSafeUrl("http://[::ffff:a9fe:a9fe]")).toBe(false);

      // Private range (10.x.x.x)
      expect(isSafeUrl("http://[::ffff:10.0.0.1]")).toBe(false);
      expect(isSafeUrl("http://[::ffff:0a00:1]")).toBe(false);

      // Unspecified
      expect(isSafeUrl("http://[::ffff:0.0.0.0]")).toBe(false);
    });

    it("allows safe public IPv4-mapped and IPv4-compatible IPv6 addresses", () => {
      // Public IP (8.8.8.8 is 0808:0808)
      expect(isSafeUrl("http://[::ffff:8.8.8.8]")).toBe(true);
      expect(isSafeUrl("http://[::ffff:0808:0808]")).toBe(true);
    });

    it("rejects invalid URLs gracefully", () => {
      expect(isSafeUrl("not-a-url")).toBe(false);
      expect(isSafeUrl("")).toBe(false);
    });
  });
});
