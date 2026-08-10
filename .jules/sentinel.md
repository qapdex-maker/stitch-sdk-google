## 2026-04-15 - IPv6 Subnet and Private DNS Suffix SSRF Bypass Protection

**Vulnerability:** The SSRF URL validator `isSafeUrl` protected against local/private network request forgery. However, it checked IPv6 addresses via literal prefix strings (`fe80:`, `fc00:`, `fd00:`), which failed to block larger subnets such as `fe81::1` (part of the `fe80::/10` link-local range) or `fc01::1` (part of the `fc00::/7` unique local range). Additionally, it did not block other common local DNS suffixes (e.g. `.lan`, `.localdomain`, `.home`, `.corp`, and `.home.arpa`), leaving them open to local hostname SSRF bypass.

**Learning:** String prefix match checks are not sufficient for multi-subnet CIDR ranges in network validation. Bitwise arithmetic is necessary to accurately capture full subnets of link-local and unique local addresses in IPv6.

**Prevention:** Perform bitwise masking and numerical checks on the parsed first 16-bit block of IPv6 addresses, and maintain a comprehensive list of standard local/internal DNS TLDs and suffixes.

## 2026-03-01 - Path Traversal Protection in File and Asset Download Handler

**Vulnerability:** The handwritten `DownloadAssetsHandler` downloaded user screen assets and saved them locally. However, if a screen's title was undefined, the handler fell back to using the raw `screenId` (or `name`) without sanitization as the base of the directory path. A malicious actor could supply a screen ID with directory traversal patterns (like `../../etc/passwd`), causing the tool to write generated code and screenshots outside the intended output directory.

**Learning:** Path traversal vulnerabilities can easily arise in utility functions (like `slugify`) if fallback behavior bypasses typical sanitization rules. Validating resolved paths against a base output directory using `path.relative` is the most reliable, cross-platform defense-in-depth shield to catch any unexpected traversal.

**Prevention:** Always resolve paths absolutely (`path.resolve`) and verify that they reside inside the expected base directory using `path.relative`. Reject any paths where the relative path starts with `..` or is absolute.

## 2026-03-05 - Path Traversal Protection in Design System Export Handler

**Vulnerability:** During design system export in `DownloadAssetsHandler`, if a design system lacked a `displayName`, the handler fell back to taking the last segment of the design system `name` via `.split("/").pop()`. If the design system name contained directory traversal segments (e.g., `assets/..`), the resolved directory path would be outside the designated output directory, enabling path traversal.

**Learning:** Secondary or peripheral export tasks (like design systems) are easily overlooked during security audits of primary tasks. Every file-writing path derived from server-returned names must be validated, regardless of whether it's considered secondary or is wrapped in try-catch blocks.

**Prevention:** Apply absolute path resolution and relative path prefix validation on every directory created and file written. If any directory resolves outside the base output directory, immediately abort with a path traversal error.

## 2026-03-10 - Path Traversal Protection in tempDir and outputDir virtual-tool validation

**Vulnerability:** During asset download, a client could specify a `tempDir` containing path traversal patterns (like `../../etc`), causing `DownloadAssetsHandler` to write intermediate files to sensitive directories outside the target output folder. Furthermore, the virtual tool `download_assets` accepted any absolute `outputDir`, allowing untrusted agent-driven tool executions to write files to arbitrary locations outside the active workspace directory.

**Learning:** Secondary absolute parameters like `tempDir` or `outputDir` in client/agent-exposed tools are high-risk vectors. Path splits using `path.sep` can be bypassed on Windows using forward slashes (`/`), so platform-neutral regex splitting `tempDir.split(/[\/\\]/)` should be used instead.

**Prevention:** Ensure `tempDir` does not escape `process.cwd()` when relative, and doesn't contain platform-neutral traversal segments when absolute. Limit agent-driven `outputDir` tool targets strictly to subfolders of the current working directory (`process.cwd()`).

## 2026-03-15 - Path Traversal Protection in projectId and REST post paths

**Vulnerability:** The handwritten `UploadHandler` and `DownloadAssetsHandler` accepted user-supplied `projectId` values, and `StitchToolClient.httpPost` accepted dynamic REST path strings without validating them against path traversal or URL manipulation sequences. A malicious client/agent could supply a project ID containing directory traversal sequences (such as `../`), which when interpolated into REST paths (e.g., `projects/${projectId}/screens:batchCreate`), would traverse paths on the Google Cloud API, allowing unexpected endpoint requests or SSRF.

**Learning:** Any dynamic parameter interpolated into HTTP URL paths or file writing paths must be strictly checked to prevent directory traversal or path characters (`..`, `/`, `\`), especially when used inside utility wrappers like `httpPost`.

**Prevention:** Ensure `projectId` does not contain any path characters (`/`, `\`, `..`), and add a defensive block inside raw HTTP helpers (like `httpPost`) to reject dynamic URL paths containing traversal sequences (`..`, `\`).

## 2026-03-20 - Enhanced Project ID Regex Validation for Path Traversal Defense

**Vulnerability:** Although previous defenses implemented `.includes('/')`, `.includes('\\')`, and `.includes('..')` checks for `projectId` inputs in both `DownloadAssetsHandler` and `UploadHandler`, these inputs were not strictly validated against a positive character allowlist. Consequently, malicious payloads containing control characters, URL-encoded path delimiters, or other injection vectors could theoretically bypass simple text inclusion checks.

**Learning:** Relying solely on blocklists (e.g. searching for specific directory traversal substrings) leaves room for bypasses via encoding variations or special character injections. Establishing a strict character allowlist (positive validation) is a much more secure and comprehensive approach.

**Prevention:** Constrain inputs representing entity IDs (such as Google Cloud project IDs) to a strict regex allowlist pattern (e.g., `/^[a-zA-Z0-9-.:_]+$/`) and combine it with explicit relative traversal checks (e.g., rejecting any sequence containing `..`).

## 2026-03-25 - Absolute and Protocol-Relative URL Injection Protection in httpPost REST Client

**Vulnerability:** While `StitchToolClient.httpPost` checked for basic relative path traversal (`..` and `\`), it did not prevent inputs with leading slashes (`/`), double slashes (`//`), absolute/protocol-relative URL sequences (like `://` or `//`), or URL parsing delimiters (like `?`, `#`, or `@`). An attacker with control over the REST path segment could construct paths that completely bypass the API path routing of the Stitch baseUrl or direct requests to arbitrary external servers, potentially leading to Server-Side Request Forgery (SSRF) or API endpoint manipulation.

**Learning:** Checking for standard relative directory traversal sequences (`..`) is not always sufficient when inputs are interpolated into HTTP base URLs or URLs queried via `fetch`. Path and protocol-relative manipulation can redirect the query context entirely.

**Prevention:** Combine strict path traversal blocklists with absolute, leading slash, double slash, and control character delimiters checks, or enforce a strict character allowlist pattern (e.g. `^[a-zA-Z0-9-.:_/]+$`) to ensure only valid path sequences are allowed.

## 2026-04-01 - Server-Side Request Forgery (SSRF) Protection in HTML and Asset Download Handler

**Vulnerability:** When downloading assets (e.g., image `src` and stylesheet `href` tags) from downloaded screen HTML code, the handler resolved and fetched arbitrary URLs. If a malicious screen or project contained references to local or private network resources (such as loopback IPs or cloud metadata service endpoints), the SDK runner would fetch those URLs. This exposed internal/local networks and cloud instance metadata to Server-Side Request Forgery (SSRF).

**Learning:** Parsing third-party content and downloading embedded asset links poses a direct SSRF risk, especially if the code runs on developer machines or build/CI environments with local/private network access. URLs must be fully validated before any fetch call is made.

**Prevention:** Implement a positive URL safety checker that parses the URL with WHATWG parser and explicitly rejects loopback IPs, private IP ranges (RFC 1918), link-local IPs, metadata service hostnames, or reserved local/internal TLDs. Apply this validation to all fetched assets, screenshots, and remote sources.

## 2026-04-05 - SSRF IPv6 Mapped and Compatible IPv4 Address Bypass Protection

**Vulnerability:** The SSRF URL validator `isSafeUrl` in `packages/sdk/src/utils.ts` validated standard IPv4 and IPv6 addresses. However, it did not check for IPv4-mapped IPv6 addresses (e.g. `[::ffff:127.0.0.1]` or `[::ffff:7f00:1]`) or IPv4-compatible IPv6 addresses (e.g. `[::7f00:1]`). These URLs are parsed and resolved to restricted/private networks (like loopback or link-local metadata endpoints), allowing attackers to completely bypass standard SSRF protections.

**Learning:** URL normalization logic across different runtimes (Node, Bun, browser) maps complex IPv6 formats to standard colon-separated or dotted-decimal formats. Simple substring matching or protocol checks are bypassed by mapped representations. It is critical to translate mapped IPv6 representations back into their corresponding IPv4 octets to perform robust range validation.

**Prevention:** Check the resolved IPv6 address for standard mapped prefixes (like `::ffff:` or compatible `::`) and extract the mapped 32-bit IPv4 address (either as dotted-decimal or hex colon segments). Convert these to standard decimal octets and run standard IPv4 range validation.

## 2026-04-10 - SSRF Trailing-Dot Hostname Bypass Protection

**Vulnerability:** The SSRF URL validator `isSafeUrl` in `packages/sdk/src/utils.ts` checked hostnames against blocklists of local hostnames and private domain suffixes. However, it did not account for hostnames ending with a trailing dot (e.g., `localhost.` or `metadata.google.internal.`). Runtimes and system DNS resolvers treat trailing dots as absolute DNS names, resolving them identically to their standard names, thereby bypassing direct string blocklist checks.

**Learning:** DNS resolves absolute domain names (those with a trailing dot) exactly like relative ones. However, application-level code checking string equality (`=== "localhost"`) or suffix matching (`endsWith(".local")`) is easily bypassed by absolute domain representations if trailing dots are not normalized.

**Prevention:** Normalize all hostnames by stripping any single trailing dot before checking against string blocklists, suffix checks, and IP addresses.

## 2026-04-15 - SSRF IPv6 Non-Zero Prefix and Common Local DNS Suffix Bypass Protection

**Vulnerability:** The SSRF URL validator `isSafeUrl` in `packages/sdk/src/utils.ts` validated unique local IPv6 addresses (ULAs) and link-local ranges using static prefix checks (like `clean.startsWith("fe80:")` or `clean.startsWith("fc00:")`). However, an attacker could bypass these checks by using non-zero subnets (such as `[fc01::1]` or `[fe81::1]`), which are valid routing prefixes under `fc00::/7` and `fe80::/10` but were not covered by the exact prefix checks. Additionally, local/residential DNS suffixes like `.lan`, `.localdomain`, `.home`, `.corp`, and `.home.arpa` were not blocked, exposing private network servers to SSRF.

**Learning:** When validating IP ranges like IPv6 subnets, checking explicit starting strings is extremely brittle because of subnet masks and non-zero hex representations within CIDR blocks. Instead, parsing the first 16-bit block into a numeric integer and validating it against CIDR-defined hexadecimal limits (e.g., `0xfc00`-`0xfdff` and `0xfe80`-`0xfeff`) provides complete security coverage.

**Prevention:** Parse the first hexadecimal group of IPv6 addresses and numerically validate the 16-bit range. Additionally, maintain a comprehensive blocklist of common residential/enterprise local DNS suffixes.
