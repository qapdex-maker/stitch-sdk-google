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
