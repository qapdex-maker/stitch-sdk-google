## 2026-03-01 - Path Traversal Protection in File and Asset Download Handler

**Vulnerability:** The handwritten `DownloadAssetsHandler` downloaded user screen assets and saved them locally. However, if a screen's title was undefined, the handler fell back to using the raw `screenId` (or `name`) without sanitization as the base of the directory path. A malicious actor could supply a screen ID with directory traversal patterns (like `../../etc/passwd`), causing the tool to write generated code and screenshots outside the intended output directory.

**Learning:** Path traversal vulnerabilities can easily arise in utility functions (like `slugify`) if fallback behavior bypasses typical sanitization rules. Validating resolved paths against a base output directory using `path.relative` is the most reliable, cross-platform defense-in-depth shield to catch any unexpected traversal.

**Prevention:** Always resolve paths absolutely (`path.resolve`) and verify that they reside inside the expected base directory using `path.relative`. Reject any paths where the relative path starts with `..` or is absolute.
