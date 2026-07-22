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

import { EntityManager } from "../../src/entity-manager.js";
import { describe, it, expect, vi } from "vitest";
import * as cheerio from "cheerio";
import {
  DownloadAssetsHandler,
  sanitizeFilename,
} from "../../src/download-handler.js";

vi.mock("node:fs/promises", async (importOriginal) => {
  const real = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...real,
    mkdir: vi.fn().mockResolvedValue(undefined),
    writeFile: vi.fn().mockResolvedValue(undefined),
    rename: vi.fn().mockResolvedValue(undefined),
  };
});

describe("DownloadAssetsHandler", () => {
  it("can be instantiated", () => {
    const handler = new DownloadAssetsHandler({} as any);
    expect(handler).toBeDefined();
  });

  it("sanitizes asset filenames", async () => {
    const fs = await import("node:fs/promises");
    vi.mocked(fs.writeFile).mockClear();

    const mockClient = {
      callTool: vi.fn().mockResolvedValue({
        screens: [{ id: "s1", name: "projects/p1/screens/s1" }], // Mock screen object
      }),
    } as any;

    // Wait, getHtml is a method on Screen class in generated code!
    // If I mock callTool('list_screens') it returns raw objects!
    const mockScreen = {
      id: "s1",
      htmlCode: { downloadUrl: "http://fake/s1.html" },
    };
    mockClient.callTool.mockResolvedValue({ screens: [mockScreen] });

    const mockFetch = vi.fn().mockImplementation((url) => {
      if (url === "http://fake/s1.html") {
        return Promise.resolve({
          ok: true,
          text: () =>
            Promise.resolve(
              '<html><img src="http://example.com/bad name.png"></html>',
            ),
        });
      }
      return Promise.resolve({
        ok: true,
        arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)),
      });
    });
    vi.stubGlobal("fetch", mockFetch);

    const handler = new DownloadAssetsHandler(mockClient);
    await handler.execute({ projectId: "p1", outputDir: "/tmp/out" });

    // Temp paths contain only random bytes — the sanitized filename only appears in rename dest.
    expect(fs.writeFile).toHaveBeenCalledWith(
      expect.stringContaining(".tmp-"),
      expect.any(Object),
      expect.objectContaining({ flag: "wx", mode: 0o600 }),
    );

    expect(fs.rename).toHaveBeenCalledWith(
      expect.stringContaining(".tmp-"),
      expect.stringContaining("badname"),
    );
  });

  it("automatically appends empty alt attributes if missing, and preserves existing ones", async () => {
    const fs = await import("node:fs/promises");
    vi.mocked(fs.writeFile).mockClear();

    const mockClient = {
      callTool: vi.fn().mockResolvedValue({
        screens: [{ id: "s1", name: "projects/p1/screens/s1" }],
      }),
    } as any;

    const mockScreen = {
      id: "s1",
      htmlCode: { downloadUrl: "http://fake/s1.html" },
    };
    mockClient.callTool.mockResolvedValue({ screens: [mockScreen] });

    const mockFetch = vi.fn().mockImplementation((url) => {
      if (url === "http://fake/s1.html") {
        return Promise.resolve({
          ok: true,
          text: () =>
            Promise.resolve(
              '<html><body><img src="http://example.com/img1.png"><img src="http://example.com/img2.png" alt="Existing Alt"></body></html>',
            ),
        });
      }
      return Promise.resolve({
        ok: true,
        arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)),
      });
    });
    vi.stubGlobal("fetch", mockFetch);

    const handler = new DownloadAssetsHandler(mockClient);
    await handler.execute({ projectId: "p1", outputDir: "/tmp/out" });

    // Find the call to write code.html
    const writeFileCalls = vi.mocked(fs.writeFile).mock.calls;
    const htmlWriteCall = writeFileCalls.find(
      (call) =>
        typeof call[0] === "string" &&
        call[0].includes(".tmp-") &&
        typeof call[1] === "string" &&
        call[1].includes("<img"),
    );
    expect(htmlWriteCall).toBeDefined();
    const writtenHtml = htmlWriteCall![1] as string;

    // The first img should have got alt="" added
    expect(writtenHtml).toContain('alt=""');
    // The second img should have preserved its original alt attribute
    expect(writtenHtml).toContain('alt="Existing Alt"');
  });

  it("automatically enhances interactive element labels and decorative SVGs for accessibility", async () => {
    const fs = await import("node:fs/promises");
    vi.mocked(fs.writeFile).mockClear();

    const mockClient = {
      callTool: vi.fn().mockResolvedValue({
        screens: [{ id: "s1", name: "projects/p1/screens/s1" }],
      }),
    } as any;

    const mockScreen = {
      id: "s1",
      htmlCode: { downloadUrl: "http://fake/s1.html" },
    };
    mockClient.callTool.mockResolvedValue({ screens: [mockScreen] });

    const htmlContent =
      "<html><body>" +
      '<button id="btn1" title="Close Settings"><svg id="svg1"></svg></button>' +
      '<a id="link1" title="Home Link" aria-label="Go Home"><svg id="svg2"></svg></a>' +
      '<button id="btn2">No title but has text <svg id="svg3"></svg></button>' +
      '<button id="btn3" aria-label="Has label"><svg id="svg4" aria-hidden="false"></svg></button>' +
      "</body></html>";

    const mockFetch = vi.fn().mockImplementation((url) => {
      if (url === "http://fake/s1.html") {
        return Promise.resolve({
          ok: true,
          text: () => Promise.resolve(htmlContent),
        });
      }
      return Promise.resolve({
        ok: true,
        arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)),
      });
    });
    vi.stubGlobal("fetch", mockFetch);

    const handler = new DownloadAssetsHandler(mockClient);
    await handler.execute({ projectId: "p1", outputDir: "/tmp/out" });

    // Find the call to write code.html
    const writeFileCalls = vi.mocked(fs.writeFile).mock.calls;
    const htmlWriteCall = writeFileCalls.find(
      (call) =>
        typeof call[0] === "string" &&
        call[0].includes(".tmp-") &&
        typeof call[1] === "string" &&
        call[1].includes("button"),
    );
    expect(htmlWriteCall).toBeDefined();
    const writtenHtml = htmlWriteCall![1] as string;

    // Check Button 1: title should populate aria-label, svg1 should get aria-hidden="true"
    expect(writtenHtml).toContain(
      'id="btn1" title="Close Settings" aria-label="Close Settings"',
    );
    expect(writtenHtml).toContain('id="svg1" aria-hidden="true"');

    // Check Link 1: existing aria-label "Go Home" should be preserved (not overridden by title)
    expect(writtenHtml).toContain(
      'id="link1" title="Home Link" aria-label="Go Home"',
    );
    expect(writtenHtml).toContain('id="svg2" aria-hidden="true"');

    // Check Button 2: text content triggers aria-hidden on svg3
    expect(writtenHtml).toContain('id="svg3" aria-hidden="true"');

    // Check Button 3: svg4 already has aria-hidden="false", should not be overridden
    expect(writtenHtml).toContain('id="svg4" aria-hidden="false"');
  });

  it("automatically adds lang attribute to html and aria-label to unlabelled form controls", async () => {
    const fs = await import("node:fs/promises");
    vi.mocked(fs.writeFile).mockClear();

    const mockClient = {
      callTool: vi.fn().mockResolvedValue({
        screens: [{ id: "s1", name: "projects/p1/screens/s1" }],
      }),
    } as any;

    const mockScreen = {
      id: "s1",
      htmlCode: { downloadUrl: "http://fake/s1.html" },
    };
    mockClient.callTool.mockResolvedValue({ screens: [mockScreen] });

    const htmlContent =
      "<html><body>" +
      '<input id="input1" placeholder="Enter name">' +
      '<textarea id="textarea1" title="Comments"></textarea>' +
      '<select id="select1" placeholder="Select role"><option>Role</option></select>' +
      '<label for="input2">With label</label><input id="input2" placeholder="With label placeholder">' +
      '<label><input id="input3" placeholder="Wrapped input placeholder"></label>' +
      '<input id="input4" aria-label="Existing label" placeholder="Overridden placeholder">' +
      "</body></html>";

    const mockFetch = vi.fn().mockImplementation((url) => {
      if (url === "http://fake/s1.html") {
        return Promise.resolve({
          ok: true,
          text: () => Promise.resolve(htmlContent),
        });
      }
      return Promise.resolve({
        ok: true,
        arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)),
      });
    });
    vi.stubGlobal("fetch", mockFetch);

    const handler = new DownloadAssetsHandler(mockClient);
    await handler.execute({ projectId: "p1", outputDir: "/tmp/out" });

    const writeFileCalls = vi.mocked(fs.writeFile).mock.calls;
    const htmlWriteCall = writeFileCalls.find(
      (call) =>
        typeof call[0] === "string" &&
        call[0].includes(".tmp-") &&
        typeof call[1] === "string" &&
        call[1].includes("input"),
    );
    expect(htmlWriteCall).toBeDefined();
    const writtenHtml = htmlWriteCall![1] as string;

    // HTML lang should be added
    expect(writtenHtml).toContain('<html lang="en">');

    // Input 1: should get aria-label from placeholder
    expect(writtenHtml).toContain(
      'id="input1" placeholder="Enter name" aria-label="Enter name"',
    );

    // Textarea 1: should get aria-label from title
    expect(writtenHtml).toContain(
      'id="textarea1" title="Comments" aria-label="Comments"',
    );

    // Select 1: should get aria-label from placeholder
    expect(writtenHtml).toContain(
      'id="select1" placeholder="Select role" aria-label="Select role"',
    );

    // Input 2: has associated <label>, should NOT get aria-label
    expect(writtenHtml).toContain(
      'id="input2" placeholder="With label placeholder"',
    );
    expect(writtenHtml).not.toContain(
      'id="input2" placeholder="With label placeholder" aria-label=',
    );

    // Input 3: wrapped in <label>, should NOT get aria-label
    expect(writtenHtml).toContain(
      'id="input3" placeholder="Wrapped input placeholder"',
    );
    expect(writtenHtml).not.toContain(
      'id="input3" placeholder="Wrapped input placeholder" aria-label=',
    );

    // Input 4: has existing aria-label, should NOT be overridden
    expect(writtenHtml).toContain(
      'id="input4" aria-label="Existing label" placeholder="Overridden placeholder"',
    );
  });

  it("automatically maps visual required indicators to semantic aria-required attributes", async () => {
    const fs = await import("node:fs/promises");
    vi.mocked(fs.writeFile).mockClear();

    const mockClient = {
      callTool: vi.fn().mockResolvedValue({
        screens: [{ id: "s1", name: "projects/p1/screens/s1" }],
      }),
    } as any;

    const mockScreen = {
      id: "s1",
      htmlCode: { downloadUrl: "http://fake/s1.html" },
    };
    mockClient.callTool.mockResolvedValue({ screens: [mockScreen] });

    const htmlContent =
      "<html><body>" +
      '<label for="req1">Email *</label><input id="req1">' +
      '<label for="req2">Password (required)</label><input id="req2">' +
      '<label>First Name * <input id="req3"></label>' +
      '<input id="req4" placeholder="Last Name (Required)">' +
      '<textarea id="req5" title="Message *"></textarea>' +
      '<label for="opt1">Optional</label><input id="opt1">' +
      '<input id="req-already1" required placeholder="Already required *">' +
      '<input id="req-already2" aria-required="false" placeholder="Already false *">' +
      "</body></html>";

    const mockFetch = vi.fn().mockImplementation((url) => {
      if (url === "http://fake/s1.html") {
        return Promise.resolve({
          ok: true,
          text: () => Promise.resolve(htmlContent),
        });
      }
      return Promise.resolve({
        ok: true,
        arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)),
      });
    });
    vi.stubGlobal("fetch", mockFetch);

    const handler = new DownloadAssetsHandler(mockClient);
    await handler.execute({ projectId: "p1", outputDir: "/tmp/out" });

    const writeFileCalls = vi.mocked(fs.writeFile).mock.calls;
    const htmlWriteCall = writeFileCalls.find(
      (call) =>
        typeof call[0] === "string" &&
        call[0].includes(".tmp-") &&
        typeof call[1] === "string" &&
        call[1].includes("req1"),
    );
    expect(htmlWriteCall).toBeDefined();
    const writtenHtml = htmlWriteCall![1] as string;

    const $written = cheerio.load(writtenHtml);

    // Email * -> aria-required="true"
    expect($written("#req1").attr("aria-required")).toBe("true");

    // Password (required) -> aria-required="true"
    expect($written("#req2").attr("aria-required")).toBe("true");

    // First Name * (nested) -> aria-required="true"
    expect($written("#req3").attr("aria-required")).toBe("true");

    // Last Name (Required) (placeholder) -> aria-required="true"
    expect($written("#req4").attr("aria-required")).toBe("true");

    // Message * (title) -> aria-required="true"
    expect($written("#req5").attr("aria-required")).toBe("true");

    // Optional -> no aria-required
    expect($written("#opt1").attr("aria-required")).toBeUndefined();

    // Already required -> preserve original required (no additional aria-required="true" added)
    expect($written("#req-already1").attr("required")).toBeDefined();
    expect($written("#req-already1").attr("aria-required")).toBeUndefined();

    // Already false -> preserve original aria-required="false"
    expect($written("#req-already2").attr("aria-required")).toBe("false");
  });

  it("handles image fallback alt with title and extracts SVG titles for buttons/links", async () => {
    const fs = await import("node:fs/promises");
    vi.mocked(fs.writeFile).mockClear();

    const mockClient = {
      callTool: vi.fn().mockResolvedValue({
        screens: [{ id: "s1", name: "projects/p1/screens/s1" }],
      }),
    } as any;

    const mockScreen = {
      id: "s1",
      htmlCode: { downloadUrl: "http://fake/s1.html" },
    };
    mockClient.callTool.mockResolvedValue({ screens: [mockScreen] });

    const htmlContent =
      "<html><body>" +
      '<img id="img-with-title" title="Logo Icon">' +
      '<button id="btn-svg-title"><svg><title>Submit Form</title></svg></button>' +
      "</body></html>";

    const mockFetch = vi.fn().mockImplementation((url) => {
      if (url === "http://fake/s1.html") {
        return Promise.resolve({
          ok: true,
          text: () => Promise.resolve(htmlContent),
        });
      }
      return Promise.resolve({
        ok: true,
        arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)),
      });
    });
    vi.stubGlobal("fetch", mockFetch);

    const handler = new DownloadAssetsHandler(mockClient);
    await handler.execute({ projectId: "p1", outputDir: "/tmp/out" });

    const writeFileCalls = vi.mocked(fs.writeFile).mock.calls;
    const htmlWriteCall = writeFileCalls.find(
      (call) =>
        typeof call[0] === "string" &&
        call[0].includes(".tmp-") &&
        typeof call[1] === "string" &&
        call[1].includes("img"),
    );
    expect(htmlWriteCall).toBeDefined();
    const writtenHtml = htmlWriteCall![1] as string;

    // Image alt fallback to title should work
    expect(writtenHtml).toContain(
      'id="img-with-title" title="Logo Icon" alt="Logo Icon"',
    );

    // Button should extract its inner SVG title
    expect(writtenHtml).toContain(
      'id="btn-svg-title" aria-label="Submit Form"',
    );
  });

  it("programmatically connects adjacent unassociated label and control elements", async () => {
    const fs = await import("node:fs/promises");
    vi.mocked(fs.writeFile).mockClear();

    const mockClient = {
      callTool: vi.fn().mockResolvedValue({
        screens: [{ id: "s1", name: "projects/p1/screens/s1" }],
      }),
    } as any;

    const mockScreen = {
      id: "s1",
      htmlCode: { downloadUrl: "http://fake/s1.html" },
    };
    mockClient.callTool.mockResolvedValue({ screens: [mockScreen] });

    const htmlContent =
      "<html><body>" +
      '<label id="lbl1">Username</label><input id="inp1">' +
      '<input type="checkbox" id="chk1"><label id="lbl2">Remember me</label>' +
      "</body></html>";

    const mockFetch = vi.fn().mockImplementation((url) => {
      if (url === "http://fake/s1.html") {
        return Promise.resolve({
          ok: true,
          text: () => Promise.resolve(htmlContent),
        });
      }
      return Promise.resolve({
        ok: true,
        arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)),
      });
    });
    vi.stubGlobal("fetch", mockFetch);

    const handler = new DownloadAssetsHandler(mockClient);
    await handler.execute({ projectId: "p1", outputDir: "/tmp/out" });

    const writeFileCalls = vi.mocked(fs.writeFile).mock.calls;
    const htmlWriteCall = writeFileCalls.find(
      (call) =>
        typeof call[0] === "string" &&
        call[0].includes(".tmp-") &&
        typeof call[1] === "string" &&
        call[1].includes("lbl1"),
    );
    expect(htmlWriteCall).toBeDefined();
    const writtenHtml = htmlWriteCall![1] as string;

    // Preceding label and text input should be associated using the existing input ID
    expect(writtenHtml).toContain(
      '<label id="lbl1" for="inp1">Username</label><input id="inp1"',
    );

    // Checkbox and succeeding label should be associated using the existing checkbox ID
    expect(writtenHtml).toContain(
      '<input type="checkbox" id="chk1"><label id="lbl2" for="chk1">Remember me</label>',
    );
  });

  it("programmatically adds security rel and accessible aria-label warning to target='_blank' links", async () => {
    const fs = await import("node:fs/promises");
    vi.mocked(fs.writeFile).mockClear();

    const mockClient = {
      callTool: vi.fn().mockResolvedValue({
        screens: [{ id: "s1", name: "projects/p1/screens/s1" }],
      }),
    } as any;

    const mockScreen = {
      id: "s1",
      htmlCode: { downloadUrl: "http://fake/s1.html" },
    };
    mockClient.callTool.mockResolvedValue({ screens: [mockScreen] });

    const htmlContent =
      "<html><body>" +
      '<a id="lnk1" href="https://example.com" target="_blank">External Link</a>' +
      '<a id="lnk2" href="https://example.com" target="_blank" rel="noopener">Another External</a>' +
      '<a id="lnk3" href="https://example.com" target="_blank" aria-label="Privacy Policy">Privacy</a>' +
      '<a id="lnk4" href="https://example.com" target="_blank" aria-label="Terms (opens in a new tab)">Terms</a>' +
      "</body></html>";

    const mockFetch = vi.fn().mockImplementation((url) => {
      if (url === "http://fake/s1.html") {
        return Promise.resolve({
          ok: true,
          text: () => Promise.resolve(htmlContent),
        });
      }
      return Promise.resolve({
        ok: true,
        arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)),
      });
    });
    vi.stubGlobal("fetch", mockFetch);

    const handler = new DownloadAssetsHandler(mockClient);
    await handler.execute({ projectId: "p1", outputDir: "/tmp/out" });

    const writeFileCalls = vi.mocked(fs.writeFile).mock.calls;
    const htmlWriteCall = writeFileCalls.find(
      (call) =>
        typeof call[0] === "string" &&
        call[0].includes(".tmp-") &&
        typeof call[1] === "string" &&
        call[1].includes("lnk1"),
    );
    expect(htmlWriteCall).toBeDefined();
    const writtenHtml = htmlWriteCall![1] as string;

    // Load writtenHtml with cheerio to parse cleanly and verify attributes
    const $written = cheerio.load(writtenHtml);

    const lnk1 = $written("#lnk1");
    expect(lnk1.attr("rel")).toBe("noopener noreferrer");
    expect(lnk1.attr("aria-label")).toBe("External Link (opens in a new tab)");

    const lnk2 = $written("#lnk2");
    expect(lnk2.attr("rel")).toBe("noopener noreferrer");
    expect(lnk2.attr("aria-label")).toBe(
      "Another External (opens in a new tab)",
    );

    const lnk3 = $written("#lnk3");
    expect(lnk3.attr("rel")).toBe("noopener noreferrer");
    expect(lnk3.attr("aria-label")).toBe("Privacy Policy (opens in a new tab)");

    const lnk4 = $written("#lnk4");
    expect(lnk4.attr("rel")).toBe("noopener noreferrer");
    expect(lnk4.attr("aria-label")).toBe("Terms (opens in a new tab)");
  });

  it("prevents directory traversal", async () => {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    vi.mocked(fs.writeFile).mockClear();

    const mockClient = {
      callTool: vi.fn().mockResolvedValue({
        screens: [{ id: "s1", name: "projects/p1/screens/s1" }],
      }),
    } as any;

    const mockScreen = {
      id: "s1",
      getHtml: vi.fn().mockResolvedValue("http://fake/s1.html"),
    };
    mockClient.callTool.mockResolvedValue({ screens: [mockScreen] });

    const mockFetch = vi.fn().mockImplementation((url) => {
      if (url === "http://fake/s1.html") {
        return Promise.resolve({
          ok: true,
          text: () =>
            Promise.resolve(
              '<html><img src="http://example.com/%2e%2e/etc/passwd"></html>',
            ),
        });
      }
      return Promise.resolve({
        ok: true,
        arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)),
      });
    });
    vi.stubGlobal("fetch", mockFetch);

    const handler = new DownloadAssetsHandler(mockClient);
    await handler.execute({ projectId: "p1", outputDir: "/tmp/out" });

    const calls = vi.mocked(fs.writeFile).mock.calls;
    for (const [filePath] of calls) {
      expect(typeof filePath).toBe("string");
      if (typeof filePath === "string") {
        if (filePath.includes("/assets/")) {
          expect(filePath).toContain("/tmp/out/s1/assets/");
          const filename = path.basename(filePath);
          expect(filename).not.toContain("..");
        } else {
          expect(filePath).toBe("/tmp/out/s1/code.html");
        }
      }
    }
  });

  it("returns failure if list_screens fails", async () => {
    const mockClient = {
      callTool: vi.fn().mockRejectedValue(new Error("API Error")),
    } as any;

    const handler = new DownloadAssetsHandler(mockClient);
    const result = await handler.execute({
      projectId: "p1",
      outputDir: "/tmp/out",
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe("UNKNOWN_ERROR");
    }
  });

  it("respects custom fileMode option", async () => {
    const fs = await import("node:fs/promises");
    vi.mocked(fs.writeFile).mockClear();

    const mockClient = { callTool: vi.fn() } as any;
    const mockScreen = {
      id: "s1",
      htmlCode: { downloadUrl: "http://fake/s1.html" },
    };
    mockClient.callTool.mockResolvedValue({ screens: [mockScreen] });

    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((url) => {
        if (url === "http://fake/s1.html") {
          return Promise.resolve({
            ok: true,
            text: () => Promise.resolve("<html></html>"),
          });
        }
        return Promise.resolve({
          ok: true,
          arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)),
        });
      }),
    );

    const handler = new DownloadAssetsHandler(mockClient);
    await handler.execute({
      projectId: "p1",
      outputDir: "/tmp/out",
      fileMode: 0o644,
    });

    expect(fs.writeFile).toHaveBeenCalledWith(
      expect.any(String),
      expect.anything(),
      expect.objectContaining({ mode: 0o644 }),
    );
  });

  it("uses custom assetsSubdir option", async () => {
    const fs = await import("node:fs/promises");
    vi.mocked(fs.mkdir).mockClear();
    vi.mocked(fs.writeFile).mockClear();

    const mockClient = { callTool: vi.fn() } as any;
    const mockScreen = {
      id: "s1",
      htmlCode: { downloadUrl: "http://fake/s1.html" },
    };
    mockClient.callTool.mockResolvedValue({ screens: [mockScreen] });

    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((url) => {
        if (url === "http://fake/s1.html") {
          return Promise.resolve({
            ok: true,
            text: () =>
              Promise.resolve(
                '<html><img src="http://example.com/img.png"></html>',
              ),
          });
        }
        return Promise.resolve({
          ok: true,
          arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)),
        });
      }),
    );

    const handler = new DownloadAssetsHandler(mockClient);
    await handler.execute({
      projectId: "p1",
      outputDir: "/tmp/out",
      assetsSubdir: "static",
    });

    expect(fs.mkdir).toHaveBeenCalledWith(
      expect.stringContaining("static"),
      expect.anything(),
    );
  });

  it("uses custom tempDir for atomic temp files", async () => {
    const fs = await import("node:fs/promises");
    vi.mocked(fs.writeFile).mockClear();
    vi.mocked(fs.rename).mockClear();

    const mockClient = { callTool: vi.fn() } as any;
    const mockScreen = {
      id: "s1",
      htmlCode: { downloadUrl: "http://fake/s1.html" },
    };
    mockClient.callTool.mockResolvedValue({ screens: [mockScreen] });

    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((url) => {
        if (url === "http://fake/s1.html") {
          return Promise.resolve({
            ok: true,
            text: () => Promise.resolve("<html></html>"),
          });
        }
        return Promise.resolve({
          ok: true,
          arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)),
        });
      }),
    );

    const handler = new DownloadAssetsHandler(mockClient);
    await handler.execute({
      projectId: "p1",
      outputDir: "/tmp/out",
      tempDir: "/custom/tmp",
    });

    // Temp writes go to /custom/tmp, final rename targets go to /tmp/out
    expect(fs.writeFile).toHaveBeenCalledWith(
      expect.stringContaining("/custom/tmp/"),
      expect.anything(),
      expect.objectContaining({ flag: "wx" }),
    );
    expect(fs.rename).toHaveBeenCalledWith(
      expect.stringContaining("/custom/tmp/"),
      expect.stringContaining("/tmp/out/"),
    );
  });

  it("extracts screen ID from name if id is missing", async () => {
    const fs = await import("node:fs/promises");
    vi.mocked(fs.rename).mockClear();

    const mockClient = {
      callTool: vi.fn().mockResolvedValue({
        screens: [
          {
            name: "projects/p1/screens/s123",
            htmlCode: { downloadUrl: "http://fake/s123.html" },
          },
        ],
      }),
    } as any;

    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((url) => {
        return Promise.resolve({
          ok: true,
          text: () => Promise.resolve("<html></html>"),
        });
      }),
    );

    const handler = new DownloadAssetsHandler(mockClient);
    await handler.execute({ projectId: "p1", outputDir: "/tmp/out" });

    expect(fs.rename).toHaveBeenCalledWith(
      expect.any(String),
      expect.stringContaining("/tmp/out/s123/code.html"),
    );
  });

  it("downloads screenshot if available", async () => {
    const fs = await import("node:fs/promises");
    vi.mocked(fs.writeFile).mockClear();
    vi.mocked(fs.rename).mockClear();

    const mockClient = { callTool: vi.fn() } as any;
    const mockScreen = {
      id: "s1",
      htmlCode: { downloadUrl: "http://fake/s1.html" },
      screenshot: { downloadUrl: "http://fake/s1.png" },
    };
    mockClient.callTool.mockResolvedValue({ screens: [mockScreen] });

    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((url) => {
        if (url === "http://fake/s1.html") {
          return Promise.resolve({
            ok: true,
            text: () => Promise.resolve("<html></html>"),
          });
        }
        if (url === "http://fake/s1.png") {
          return Promise.resolve({
            ok: true,
            arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)),
          });
        }
        return Promise.resolve({
          ok: true,
          arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)),
        });
      }),
    );

    const handler = new DownloadAssetsHandler(mockClient);
    await handler.execute({ projectId: "p1", outputDir: "/tmp/out" });

    expect(fs.writeFile).toHaveBeenCalledWith(
      expect.stringContaining(".tmp-screen-"),
      expect.any(Buffer),
      expect.any(Object),
    );

    expect(fs.rename).toHaveBeenCalledWith(
      expect.stringContaining(".tmp-screen-"),
      expect.stringContaining("/tmp/out/s1/screen.png"),
    );
  });

  it("exports design system if available", async () => {
    const fs = await import("node:fs/promises");
    vi.mocked(fs.writeFile).mockClear();
    vi.mocked(fs.rename).mockClear();
    vi.mocked(fs.mkdir).mockClear();

    const mockClient = { callTool: vi.fn() } as any;
    mockClient.callTool.mockImplementation(
      (tool: string, args: Record<string, unknown>) => {
        if (tool === "list_screens") {
          return Promise.resolve({ screens: [] });
        }
        if (tool === "list_design_systems") {
          return Promise.resolve({
            ok: true,
            designSystems: [
              {
                name: "assets/ds1",
                designSystem: {
                  displayName: "My Design System",
                  theme: {
                    designMd: "# High Contrast Design",
                  },
                },
              },
            ],
          });
        }
        return Promise.resolve({ ok: true });
      },
    );

    const handler = new DownloadAssetsHandler(mockClient);
    await handler.execute({ projectId: "p1", outputDir: "/tmp/out" });

    expect(fs.mkdir).toHaveBeenCalledWith(
      expect.stringContaining("/tmp/out/my_design_system"),
      expect.anything(),
    );

    expect(fs.writeFile).toHaveBeenCalledWith(
      expect.stringContaining(".tmp-ds-"),
      "# High Contrast Design",
      expect.any(Object),
    );

    expect(fs.rename).toHaveBeenCalledWith(
      expect.stringContaining(".tmp-ds-"),
      expect.stringContaining("/tmp/out/my_design_system/DESIGN.md"),
    );
  });

  it("returns a detailed trace of downloaded screens in result", async () => {
    const mockClient = {
      callTool: vi.fn().mockResolvedValue({
        screens: [
          {
            id: "s1",
            title: "Home Screen",
            htmlCode: { downloadUrl: "http://fake/s1.html" },
          },
        ],
      }),
    } as any;

    const mockFetch = vi.fn().mockImplementation((_url) => {
      return Promise.resolve({
        ok: true,
        text: () => Promise.resolve("<html></html>"),
      });
    });
    vi.stubGlobal("fetch", mockFetch);

    const handler = new DownloadAssetsHandler(mockClient);
    const result = await handler.execute({
      projectId: "p1",
      outputDir: "/tmp/out",
    });

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.downloadedScreens).toEqual([
      {
        screenId: "s1",
        screenSlug: "home_screen",
        filePath: "home_screen/code.html",
      },
    ]);
  });
});

describe("sanitizeFilename", () => {
  it("removes special characters", () => {
    const result = sanitizeFilename("bad name!@#$%^&*().png", ".png");
    expect(result).toBe("badname");
  });

  it("keeps alphanumeric, hyphen, and underscore", () => {
    const result = sanitizeFilename("good-name_123.png", ".png");
    expect(result).toBe("good-name_123");
  });

  it("slices to 100 characters", () => {
    const longName = "a".repeat(150) + ".png";
    const result = sanitizeFilename(longName, ".png");
    expect(result.length).toBe(100);
    expect(result).toBe("a".repeat(100));
  });

  it("handles empty base name after sanitization", () => {
    const result = sanitizeFilename("!!!.png", ".png");
    expect(result).toBe("");
  });
});

describe("DownloadAssetsHandler warnings", () => {
  it("collects warning for failed screenshot download", async () => {
    const fs = await import("node:fs/promises");
    vi.mocked(fs.writeFile).mockClear();
    vi.mocked(fs.rename).mockClear();
    vi.mocked(fs.mkdir).mockClear();

    const mockClient = { callTool: vi.fn() } as any;
    mockClient.callTool.mockImplementation((tool: string) => {
      if (tool === "list_screens") {
        return Promise.resolve({
          ok: true,
          screens: [
            {
              id: "s1",
              htmlCode: { downloadUrl: "http://fake/s1.html" },
              screenshot: { downloadUrl: "http://fake/screenshot.png" },
            },
          ],
        });
      }
      if (tool === "list_design_systems") {
        return Promise.resolve({ ok: true, designSystems: [] });
      }
      return Promise.resolve({ ok: true });
    });

    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((url: string) => {
        if (url === "http://fake/s1.html") {
          return Promise.resolve({
            ok: true,
            text: () => Promise.resolve("<html><body>Hello</body></html>"),
          });
        }
        if (url === "http://fake/screenshot.png") {
          return Promise.reject(new Error("Network error"));
        }
        return Promise.resolve({
          ok: true,
          arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)),
        });
      }),
    );

    const handler = new DownloadAssetsHandler(mockClient);
    const result = await handler.execute({
      projectId: "p1",
      outputDir: "/tmp/out",
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.warnings).toBeDefined();
      expect(result.warnings!.length).toBeGreaterThan(0);
      expect(result.warnings![0].toLowerCase()).toContain("screenshot");
    }
  });

  it("collects warning when design system export fails", async () => {
    const fs = await import("node:fs/promises");
    vi.mocked(fs.writeFile).mockClear();
    vi.mocked(fs.rename).mockClear();
    vi.mocked(fs.mkdir).mockClear();

    const mockClient = { callTool: vi.fn() } as any;
    mockClient.callTool.mockImplementation((tool: string) => {
      if (tool === "list_screens") {
        return Promise.resolve({ screens: [] });
      }
      if (tool === "list_design_systems") {
        return Promise.reject(new Error("API unavailable"));
      }
      return Promise.resolve({ ok: true });
    });

    const handler = new DownloadAssetsHandler(mockClient);
    const result = await handler.execute({
      projectId: "p1",
      outputDir: "/tmp/out",
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.warnings).toBeDefined();
      expect(
        result.warnings!.some((w) => w.toLowerCase().includes("design system")),
      ).toBe(true);
    }
  });
});

describe("DownloadAssetsHandler concurrency", () => {
  it("limits concurrent asset fetches to CONCURRENCY_LIMIT", async () => {
    const fs = await import("node:fs/promises");
    vi.mocked(fs.writeFile).mockClear();
    vi.mocked(fs.rename).mockClear();
    vi.mocked(fs.mkdir).mockClear();

    // Build HTML with 10 images
    const imgTags = Array.from(
      { length: 10 },
      (_, i) => `<img src="http://cdn.example.com/asset-${i}.png">`,
    ).join("");
    const html = `<html><body>${imgTags}</body></html>`;

    const mockClient = { callTool: vi.fn() } as any;
    mockClient.callTool.mockImplementation((tool: string) => {
      if (tool === "list_screens") {
        return Promise.resolve({
          ok: true,
          screens: [
            { id: "s1", htmlCode: { downloadUrl: "http://fake/s1.html" } },
          ],
        });
      }
      if (tool === "list_design_systems") {
        return Promise.resolve({ ok: true, designSystems: [] });
      }
      return Promise.resolve({ ok: true });
    });

    let active = 0;
    let peak = 0;

    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(async (url: string) => {
        if (url === "http://fake/s1.html") {
          return { text: () => Promise.resolve(html) };
        }
        // Asset fetch — track concurrency
        active++;
        peak = Math.max(peak, active);
        await new Promise((r) => setTimeout(r, 20));
        active--;
        return { arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)) };
      }),
    );

    const handler = new DownloadAssetsHandler(mockClient);
    await handler.execute({ projectId: "p1", outputDir: "/tmp/out" });

    expect(peak).toBeLessThanOrEqual(5);
  });
});

describe("Project.downloadAssets() facade", () => {
  it("surfaces warnings from handler in result", async () => {
    const fs = await import("node:fs/promises");
    vi.mocked(fs.writeFile).mockClear();
    vi.mocked(fs.rename).mockClear();
    vi.mocked(fs.mkdir).mockClear();

    const { Project } = await import("../../src/project-ext.js");

    const mockClient = { callTool: vi.fn(), httpPost: vi.fn() } as any;
    mockClient.entities = new EntityManager(mockClient);
    mockClient.callTool.mockImplementation((tool: string) => {
      if (tool === "list_screens") {
        return Promise.resolve({
          ok: true,
          screens: [
            {
              id: "s1",
              htmlCode: { downloadUrl: "http://fake/s1.html" },
              screenshot: { downloadUrl: "http://fake/screenshot.png" },
            },
          ],
        });
      }
      if (tool === "list_design_systems") {
        return Promise.resolve({ ok: true, designSystems: [] });
      }
      return Promise.resolve({ ok: true });
    });

    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((url: string) => {
        if (url === "http://fake/s1.html") {
          return Promise.resolve({
            ok: true,
            text: () => Promise.resolve("<html><body>Hello</body></html>"),
          });
        }
        if (url === "http://fake/screenshot.png") {
          return Promise.reject(new Error("Network error"));
        }
        return Promise.resolve({
          ok: true,
          arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)),
        });
      }),
    );

    const project = mockClient.entities.resolve(Project, ["projectId"], "p1");
    const result = await project.downloadAssets("/tmp/out");

    expect(result.warnings).toBeDefined();
    expect(result.warnings.length).toBeGreaterThan(0);
    expect(result.warnings[0].toLowerCase()).toContain("screenshot");
    expect(result.screens.length).toBe(1);
  });

  it("returns empty warnings array on clean run", async () => {
    const fs = await import("node:fs/promises");
    vi.mocked(fs.writeFile).mockClear();
    vi.mocked(fs.rename).mockClear();
    vi.mocked(fs.mkdir).mockClear();

    const { Project } = await import("../../src/project-ext.js");

    const mockClient = { callTool: vi.fn(), httpPost: vi.fn() } as any;
    mockClient.entities = new EntityManager(mockClient);
    mockClient.callTool.mockImplementation((tool: string) => {
      if (tool === "list_screens") {
        return Promise.resolve({
          ok: true,
          screens: [
            { id: "s1", htmlCode: { downloadUrl: "http://fake/s1.html" } },
          ],
        });
      }
      if (tool === "list_design_systems") {
        return Promise.resolve({ ok: true, designSystems: [] });
      }
      return Promise.resolve({ ok: true });
    });

    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(() => {
        return Promise.resolve({
          ok: true,
          text: () => Promise.resolve("<html><body>OK</body></html>"),
        });
      }),
    );

    const project = mockClient.entities.resolve(Project, ["projectId"], "p1");
    const result = await project.downloadAssets("/tmp/out");

    expect(result.warnings).toEqual([]);
    expect(result.screens.length).toBe(1);
  });
});
