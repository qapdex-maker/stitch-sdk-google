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

  it("automatically adds aria-required='true' when visual required indicators are present", async () => {
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
      '<label for="inp-req-ast">Username *</label><input id="inp-req-ast">' +
      '<label for="inp-req-word">Email (required)</label><input id="inp-req-word">' +
      '<label><input id="inp-req-nested">* Password</label>' +
      '<input id="inp-req-placeholder" placeholder="Required input">' +
      '<input id="inp-req-title" title="First Name *">' +
      '<input id="inp-req-aria" aria-label="Last Name (Required)">' +
      '<input id="inp-non-req" placeholder="Optional info">' +
      '<input id="inp-existing-req" required placeholder="With asterisk *">' +
      '<input id="inp-existing-aria" aria-required="false" placeholder="With asterisk *">' +
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
        call[1].includes("inp-req-ast"),
    );
    expect(htmlWriteCall).toBeDefined();
    const writtenHtml = htmlWriteCall![1] as string;

    const $written = cheerio.load(writtenHtml);

    // Associated label has asterisk
    expect($written("#inp-req-ast").attr("aria-required")).toBe("true");

    // Associated label has "required"
    expect($written("#inp-req-word").attr("aria-required")).toBe("true");

    // Nested label has asterisk
    expect($written("#inp-req-nested").attr("aria-required")).toBe("true");

    // Placeholder has "Required"
    expect($written("#inp-req-placeholder").attr("aria-required")).toBe("true");

    // Title has asterisk
    expect($written("#inp-req-title").attr("aria-required")).toBe("true");

    // Aria-label has "Required"
    expect($written("#inp-req-aria").attr("aria-required")).toBe("true");

    // Non-required input should not have aria-required
    expect($written("#inp-non-req").attr("aria-required")).toBeUndefined();

    // Already has required attribute - should not override with aria-required (required is already native semantic)
    expect($written("#inp-existing-req").attr("aria-required")).toBeUndefined();

    // Already has aria-required="false" - should respect it
    expect($written("#inp-existing-aria").attr("aria-required")).toBe("false");
  });

  it("automatically adds standard autocomplete attributes to input/textarea elements when missing", async () => {
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
      '<input id="inp-email-1" type="email">' +
      '<input id="inp-email-2" placeholder="Your Email Address">' +
      '<input id="inp-pass-1" type="password">' +
      '<input id="inp-pass-new" name="new-password" type="password">' +
      '<input id="inp-username" name="user_name">' +
      '<input id="inp-firstname" id="first-name">' +
      '<input id="inp-lastname" title="Last Name">' +
      '<input id="inp-fullname" placeholder="Name">' +
      '<input id="inp-tel" type="tel">' +
      '<input id="inp-zip" name="postal_code">' +
      '<input id="inp-country" name="country">' +
      '<input id="inp-existing" autocomplete="organization" placeholder="Company">' +
      '<select id="sel-country" name="country"><option>US</option></select>' +
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
        call[1].includes("inp-email-1"),
    );
    expect(htmlWriteCall).toBeDefined();
    const writtenHtml = htmlWriteCall![1] as string;

    const $written = cheerio.load(writtenHtml);

    expect($written("#inp-email-1").attr("autocomplete")).toBe("email");
    expect($written("#inp-email-2").attr("autocomplete")).toBe("email");
    expect($written("#inp-pass-1").attr("autocomplete")).toBe(
      "current-password",
    );
    expect($written("#inp-pass-new").attr("autocomplete")).toBe("new-password");
    expect($written("#inp-username").attr("autocomplete")).toBe("username");
    expect($written("#inp-firstname").attr("autocomplete")).toBe("given-name");
    expect($written("#inp-lastname").attr("autocomplete")).toBe("family-name");
    expect($written("#inp-fullname").attr("autocomplete")).toBe("name");
    expect($written("#inp-tel").attr("autocomplete")).toBe("tel");
    expect($written("#inp-zip").attr("autocomplete")).toBe("postal-code");
    expect($written("#inp-country").attr("autocomplete")).toBe("country");
    expect($written("#inp-existing").attr("autocomplete")).toBe("organization");
    // select elements should NOT get autocomplete
    expect($written("#sel-country").attr("autocomplete")).toBeUndefined();
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

  it("programmatically associates adjacent helper and error text elements using aria-describedby", async () => {
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
      '<input id="inp-help"><div class="help-text">Enter your username</div>' +
      '<input id="inp-err"><p id="my-custom-err" class="error-msg">Incorrect format</p>' +
      '<input id="inp-desc-already" aria-describedby="custom-desc"><span class="desc" id="custom-desc">Already linked</span>' +
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
        call[1].includes("inp-help"),
    );
    expect(htmlWriteCall).toBeDefined();
    const writtenHtml = htmlWriteCall![1] as string;

    const $written = cheerio.load(writtenHtml);

    // Check sibling helper text gets auto ID and maps to aria-describedby
    const inpHelp = $written("#inp-help");
    const autoId = inpHelp.attr("aria-describedby");
    expect(autoId).toBeDefined();
    expect(autoId).toContain("auto-desc-");
    expect($written(`#${autoId}`).text()).toBe("Enter your username");

    // Check sibling error text preserves original ID and maps to aria-describedby
    const inpErr = $written("#inp-err");
    expect(inpErr.attr("aria-describedby")).toBe("my-custom-err");

    // Check input with existing aria-describedby preserves it
    const inpDescAlready = $written("#inp-desc-already");
    expect(inpDescAlready.attr("aria-describedby")).toBe("custom-desc");
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

  it("programmatically ensures keyboard and role accessibility for custom clickable elements with onclick", async () => {
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
      '<div id="div-click" onclick="doSomething()">Click me</div>' +
      '<span id="span-click" onclick="doSomethingElse()" role="link">Styled Link</span>' +
      '<i id="i-click" onclick="iconClick()" tabindex="-1">Icon Click</i>' +
      '<button id="btn-click" onclick="buttonClick()">Native Button</button>' +
      '<a id="a-click" onclick="linkClick()" href="#">Native Link</a>' +
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
        call[1].includes("div-click"),
    );
    expect(htmlWriteCall).toBeDefined();
    const writtenHtml = htmlWriteCall![1] as string;

    const $written = cheerio.load(writtenHtml);

    // non-interactive div element with onclick should have got role="button", tabindex="0", and keyboard listener
    const divClick = $written("#div-click");
    expect(divClick.attr("role")).toBe("button");
    expect(divClick.attr("tabindex")).toBe("0");
    expect(divClick.attr("onkeydown")).toBe(
      "if (event.key === 'Enter' || event.key === ' ') { this.click(); event.preventDefault(); }",
    );

    // non-interactive span element with custom role should keep role and get tabindex="0" and keyboard listener
    const spanClick = $written("#span-click");
    expect(spanClick.attr("role")).toBe("link");
    expect(spanClick.attr("tabindex")).toBe("0");
    expect(spanClick.attr("onkeydown")).toBe(
      "if (event.key === 'Enter' || event.key === ' ') { this.click(); event.preventDefault(); }",
    );

    // non-interactive i element with custom tabindex should keep tabindex and get role="button" and keyboard listener
    const iClick = $written("#i-click");
    expect(iClick.attr("role")).toBe("button");
    expect(iClick.attr("tabindex")).toBe("-1");
    expect(iClick.attr("onkeydown")).toBe(
      "if (event.key === 'Enter' || event.key === ' ') { this.click(); event.preventDefault(); }",
    );

    // Native interactive button should not have role, tabindex, or onkeydown added
    const btnClick = $written("#btn-click");
    expect(btnClick.attr("role")).toBeUndefined();
    expect(btnClick.attr("tabindex")).toBeUndefined();
    expect(btnClick.attr("onkeydown")).toBeUndefined();

    // Native interactive link should not have role, tabindex, or onkeydown added
    const aClick = $written("#a-click");
    expect(aClick.attr("role")).toBeUndefined();
    expect(aClick.attr("tabindex")).toBeUndefined();
    expect(aClick.attr("onkeydown")).toBeUndefined();
  });

  it("programmatically tags search input container with role='search' when missing", async () => {
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
      '<form id="form-search"><input type="search" id="inp-search-1"></form>' +
      '<div id="div-search"><input id="inp-search-2" name="search_query"></div>' +
      '<section id="sec-search"><input id="inp-search-3" placeholder="Search blog..."></section>' +
      '<form id="form-ignored" role="none"><input type="search" id="inp-search-4"></form>' +
      '<form id="form-has-landmark" role="search"><div id="div-nested"><input type="search" id="inp-search-5"></div></form>' +
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
        call[1].includes("form-search"),
    );
    expect(htmlWriteCall).toBeDefined();
    const writtenHtml = htmlWriteCall![1] as string;

    const $written = cheerio.load(writtenHtml);

    // Form search should get role="search"
    expect($written("#form-search").attr("role")).toBe("search");

    // Div search should get role="search"
    expect($written("#div-search").attr("role")).toBe("search");

    // Section search should get role="search"
    expect($written("#sec-search").attr("role")).toBe("search");

    // Form ignored has pre-existing role="none", should NOT get overridden
    expect($written("#form-ignored").attr("role")).toBe("none");

    // Div nested inside form-has-landmark should NOT get role="search" because it already has a search landmark ancestor
    expect($written("#div-nested").attr("role")).toBeUndefined();
  });

  it("programmatically tags active navigation links with aria-current='page'", async () => {
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
      '<a id="lnk-active" class="nav-item active" href="/home">Home</a>' +
      '<a id="lnk-current" class="current" href="/blog">Blog</a>' +
      '<li class="selected"><a id="lnk-parent-selected" href="/contact">Contact</a></li>' +
      '<a id="lnk-existing-current" class="active" aria-current="step" href="/dashboard">Dashboard</a>' +
      '<a id="lnk-inactive" class="nav-item" href="/about">About</a>' +
      '<a id="lnk-false-positive-1" class="interactive" href="/services">Services</a>' +
      '<a id="lnk-false-positive-2" class="concurrent" href="/faq">FAQ</a>' +
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
        call[1].includes("lnk-active"),
    );
    expect(htmlWriteCall).toBeDefined();
    const writtenHtml = htmlWriteCall![1] as string;

    const $written = cheerio.load(writtenHtml);

    // Active link should get aria-current="page"
    expect($written("#lnk-active").attr("aria-current")).toBe("page");

    // Current link should get aria-current="page"
    expect($written("#lnk-current").attr("aria-current")).toBe("page");

    // Parent selected link should get aria-current="page"
    expect($written("#lnk-parent-selected").attr("aria-current")).toBe("page");

    // Existing aria-current should be preserved and not overridden
    expect($written("#lnk-existing-current").attr("aria-current")).toBe("step");

    // Inactive link should not get aria-current
    expect($written("#lnk-inactive").attr("aria-current")).toBeUndefined();

    // Partial matches / false positives should not trigger active state
    expect(
      $written("#lnk-false-positive-1").attr("aria-current"),
    ).toBeUndefined();
    expect(
      $written("#lnk-false-positive-2").attr("aria-current"),
    ).toBeUndefined();
  });

  it("programmatically tags search input containers with role='search'", async () => {
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
      '<form id="frm1"><input id="search-input" type="search"></form>' +
      '<div id="div1"><input id="search-text-input" placeholder="Search site..."></div>' +
      '<section id="sec1" role="region"><input id="search-via-title" title="Search books"></section>' +
      '<div id="div-existing" role="none"><input id="search-existing" name="search"></div>' +
      '<form id="frm-non-search"><input id="normal-text-input" type="text" placeholder="Username"></form>' +
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
        call[1].includes("search-input"),
    );
    expect(htmlWriteCall).toBeDefined();
    const writtenHtml = htmlWriteCall![1] as string;

    const $written = cheerio.load(writtenHtml);

    // Form container enclosing type="search" should get role="search"
    expect($written("#frm1").attr("role")).toBe("search");

    // Div container enclosing input with placeholder matching /search/i should get role="search"
    expect($written("#div1").attr("role")).toBe("search");

    // Section container enclosing input with title matching /search/i should get role="search"
    // Since Section container had role="region", it should be preserved and not overridden
    expect($written("#sec1").attr("role")).toBe("region");

    // Div container enclosing input with name matching /search/i should be preserved if role exists
    expect($written("#div-existing").attr("role")).toBe("none");

    // Form container with a standard non-search field should not get role="search"
    expect($written("#frm-non-search").attr("role")).toBeUndefined();
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

  it("returns PATH_TRAVERSAL_ATTEMPT error if projectId contains path traversal", async () => {
    const mockClient = {
      callTool: vi.fn(),
    } as any;

    const handler = new DownloadAssetsHandler(mockClient);
    const result = await handler.execute({
      projectId: "p1/../../evil",
      outputDir: "/tmp/out",
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe("PATH_TRAVERSAL_ATTEMPT");
      expect(result.error.message).toContain(
        "Path traversal attempt detected in projectId",
      );
    }
  });

  it("returns PATH_TRAVERSAL_ATTEMPT error if screenId contains path traversal and title is missing", async () => {
    const mockClient = {
      callTool: vi.fn().mockResolvedValue({
        screens: [
          {
            id: "../../evil-id",
          },
        ],
      }),
    } as any;

    const handler = new DownloadAssetsHandler(mockClient);
    const result = await handler.execute({
      projectId: "p1",
      outputDir: "/tmp/out",
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe("PATH_TRAVERSAL_ATTEMPT");
      expect(result.error.message).toContain(
        "Path traversal attempt detected in screen slug",
      );
    }
  });

  it("returns PATH_TRAVERSAL_ATTEMPT error if assetsSubdir resolves outside screen directory", async () => {
    const mockClient = {
      callTool: vi.fn().mockResolvedValue({
        screens: [
          {
            id: "s1",
            htmlCode: { downloadUrl: "http://fake/s1.html" },
          },
        ],
      }),
    } as any;

    const mockFetch = vi.fn().mockImplementation((url) => {
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
      assetsSubdir: "..",
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe("PATH_TRAVERSAL_ATTEMPT");
      expect(result.error.message).toContain(
        "Path traversal attempt detected in assets directory",
      );
    }
  });

  it("returns PATH_TRAVERSAL_ATTEMPT error if tempDir contains path traversal", async () => {
    const mockClient = {
      callTool: vi.fn().mockResolvedValue({
        screens: [
          {
            id: "s1",
            htmlCode: { downloadUrl: "http://fake/s1.html" },
          },
        ],
      }),
    } as any;

    const handler = new DownloadAssetsHandler(mockClient);
    const result = await handler.execute({
      projectId: "p1",
      outputDir: "/tmp/out",
      tempDir: "../../etc",
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe("PATH_TRAVERSAL_ATTEMPT");
      expect(result.error.message).toContain(
        "Path traversal attempt detected in tempDir",
      );
    }
  });

  it("returns PATH_TRAVERSAL_ATTEMPT error if absolute tempDir contains path traversal", async () => {
    const mockClient = {
      callTool: vi.fn().mockResolvedValue({
        screens: [
          {
            id: "s1",
            htmlCode: { downloadUrl: "http://fake/s1.html" },
          },
        ],
      }),
    } as any;

    const handler = new DownloadAssetsHandler(mockClient);
    const result = await handler.execute({
      projectId: "p1",
      outputDir: "/tmp/out",
      tempDir: "/tmp/../../etc",
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe("PATH_TRAVERSAL_ATTEMPT");
      expect(result.error.message).toContain(
        "Path traversal attempt detected in tempDir",
      );
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

  it("returns PATH_TRAVERSAL_ATTEMPT if design system name resolves outside output directory", async () => {
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
                name: "assets/..",
                designSystem: {
                  theme: {
                    designMd: "# Evilly Traversed Design",
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
    const result = await handler.execute({
      projectId: "p1",
      outputDir: "/tmp/out",
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe("PATH_TRAVERSAL_ATTEMPT");
      expect(result.error.message).toContain(
        "Path traversal attempt detected in design system directory",
      );
    }
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

  it("programmatically tags disabled controls and handles custom clickable disabled elements correctly", async () => {
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
      '<button id="btn-native-dis" disabled>Native Button</button>' +
      '<input id="inp-native-dis" disabled placeholder="Input">' +
      '<a id="lnk-class-dis" class="btn disabled-link disabled">Disabled Link</a>' +
      '<div id="div-onclick-dis" onclick="doSomething()" class="disabled">Custom Button</div>' +
      '<span id="span-onclick-dis" onclick="doSomethingElse()" disabled>Custom Span</span>' +
      '<button id="btn-existing-dis" disabled aria-disabled="false">Existing Aria Disabled</button>' +
      '<button id="btn-active-tailwind" class="bg-blue-500 disabled:opacity-50 hover:bg-blue-600">Active Button</button>' +
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
        call[1].includes("btn-native-dis"),
    );
    expect(htmlWriteCall).toBeDefined();
    const writtenHtml = htmlWriteCall![1] as string;

    const $written = cheerio.load(writtenHtml);

    // Native disabled button should get aria-disabled="true"
    expect($written("#btn-native-dis").attr("aria-disabled")).toBe("true");

    // Native disabled input should get aria-disabled="true"
    expect($written("#inp-native-dis").attr("aria-disabled")).toBe("true");

    // Anchor with disabled class should get aria-disabled="true"
    expect($written("#lnk-class-dis").attr("aria-disabled")).toBe("true");

    // Custom onClick div with disabled class should get aria-disabled="true" and tabindex="-1" and role="button" but NO onkeydown click helper
    const divOnclickDis = $written("#div-onclick-dis");
    expect(divOnclickDis.attr("aria-disabled")).toBe("true");
    expect(divOnclickDis.attr("tabindex")).toBe("-1");
    expect(divOnclickDis.attr("role")).toBe("button");
    expect(divOnclickDis.attr("onkeydown")).toBeUndefined();

    // Custom onClick span with custom disabled attribute should get aria-disabled="true" and tabindex="-1" and role="button" but NO onkeydown click helper
    const spanOnclickDis = $written("#span-onclick-dis");
    expect(spanOnclickDis.attr("aria-disabled")).toBe("true");
    expect(spanOnclickDis.attr("tabindex")).toBe("-1");
    expect(spanOnclickDis.attr("role")).toBe("button");
    expect(spanOnclickDis.attr("onkeydown")).toBeUndefined();

    // Already has aria-disabled="false" - should respect and not override it
    expect($written("#btn-existing-dis").attr("aria-disabled")).toBe("false");

    // Active button with Tailwind modifier like 'disabled:opacity-50' should NOT get aria-disabled="true"
    expect(
      $written("#btn-active-tailwind").attr("aria-disabled"),
    ).toBeUndefined();
  });

  it("programmatically maps accordion, dropdown, and menu triggers to appropriate aria-expanded and aria-haspopup attributes", async () => {
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
      '<button id="btn-accordion" class="accordion-toggle">FAQ 1</button>' +
      '<a id="lnk-dropdown" class="nav-dropdown-trigger" href="#">Services</a>' +
      '<div id="div-menu" role="button" class="mobile-menu-btn">Menu</div>' +
      '<button id="btn-existing-expanded" class="accordion-toggle" aria-expanded="true">Already Open</button>' +
      '<a id="lnk-existing-popup" class="dropdown" aria-haspopup="listbox">Popup</a>' +
      '<button id="btn-normal">Normal Button</button>' +
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
        call[1].includes("btn-accordion"),
    );
    expect(htmlWriteCall).toBeDefined();
    const writtenHtml = htmlWriteCall![1] as string;

    const $written = cheerio.load(writtenHtml);

    // Accordion should get aria-expanded="false"
    const accordion = $written("#btn-accordion");
    expect(accordion.attr("aria-expanded")).toBe("false");
    expect(accordion.attr("aria-haspopup")).toBeUndefined();

    // Dropdown trigger should get aria-expanded="false" and aria-haspopup="true"
    const dropdown = $written("#lnk-dropdown");
    expect(dropdown.attr("aria-expanded")).toBe("false");
    expect(dropdown.attr("aria-haspopup")).toBe("true");

    // Menu button trigger should get aria-expanded="false" and aria-haspopup="true"
    const menu = $written("#div-menu");
    expect(menu.attr("aria-expanded")).toBe("false");
    expect(menu.attr("aria-haspopup")).toBe("true");

    // Existing aria-expanded="true" should be respected and not overridden
    const existingExpanded = $written("#btn-existing-expanded");
    expect(existingExpanded.attr("aria-expanded")).toBe("true");

    // Existing aria-haspopup="listbox" should be respected and not overridden
    const existingPopup = $written("#lnk-existing-popup");
    expect(existingPopup.attr("aria-haspopup")).toBe("listbox");

    // Normal button should NOT get any toggle trigger attributes
    const normal = $written("#btn-normal");
    expect(normal.attr("aria-expanded")).toBeUndefined();
    expect(normal.attr("aria-haspopup")).toBeUndefined();
  });

  it("programmatically enriches close and dismiss triggers with a semantic aria-label", async () => {
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
      '<button id="btn-close-symbol">×</button>' +
      '<button id="btn-close-word">Dismiss</button>' +
      '<button id="btn-close-class" class="modal-close-button"></button>' +
      '<a id="lnk-close-symbol" href="#">x</a>' +
      '<div id="div-close-onclick" onclick="closeMe()">X</div>' +
      '<button id="btn-close-existing-title" title="Close Overlay">x</button>' +
      '<button id="btn-close-existing-label" aria-label="Dismiss Modal">×</button>' +
      '<button id="btn-normal-action">Save Settings</button>' +
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
        call[1].includes("btn-close-symbol"),
    );
    expect(htmlWriteCall).toBeDefined();
    const writtenHtml = htmlWriteCall![1] as string;

    const $written = cheerio.load(writtenHtml);

    // Close symbol button gets aria-label="Close"
    expect($written("#btn-close-symbol").attr("aria-label")).toBe("Close");

    // Close word button gets aria-label="Close"
    expect($written("#btn-close-word").attr("aria-label")).toBe("Close");

    // Close class button gets aria-label="Close"
    expect($written("#btn-close-class").attr("aria-label")).toBe("Close");

    // Close link gets aria-label="Close"
    expect($written("#lnk-close-symbol").attr("aria-label")).toBe("Close");

    // Custom onClick close div gets role="button" and aria-label="Close"
    const divClose = $written("#div-close-onclick");
    expect(divClose.attr("role")).toBe("button");
    expect(divClose.attr("aria-label")).toBe("Close");

    // Button with existing title keeps title and gets aria-label from title
    const btnTitle = $written("#btn-close-existing-title");
    expect(btnTitle.attr("title")).toBe("Close Overlay");
    expect(btnTitle.attr("aria-label")).toBe("Close Overlay");

    // Button with existing aria-label preserves its custom aria-label
    const btnLabel = $written("#btn-close-existing-label");
    expect(btnLabel.attr("aria-label")).toBe("Dismiss Modal");

    // Normal button does NOT get close aria-label
    const btnNormal = $written("#btn-normal-action");
    expect(btnNormal.attr("aria-label")).toBeUndefined();
  });

  it("programmatically enriches iframe elements with a descriptive title attribute", async () => {
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
      '<iframe id="ifrm-yt" src="https://www.youtube.com/embed/dQw4w9WgXcQ"></iframe>' +
      '<iframe id="ifrm-maps" src="https://maps.google.com/maps?q=london"></iframe>' +
      '<iframe id="ifrm-custom" src="https://example.com/widget"></iframe>' +
      '<iframe id="ifrm-name" name="chat-widget"></iframe>' +
      '<iframe id="login-form-widget"></iframe>' +
      '<iframe class="no-clues-frame"></iframe>' +
      '<iframe id="ifrm-existing" title="My Video" src="https://www.youtube.com/embed/dQw4w9WgXcQ"></iframe>' +
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
        call[1].includes("ifrm-yt"),
    );
    expect(htmlWriteCall).toBeDefined();
    const writtenHtml = htmlWriteCall![1] as string;

    const $written = cheerio.load(writtenHtml);

    // Youtube iframe should get title="YouTube video player"
    expect($written("#ifrm-yt").attr("title")).toBe("YouTube video player");

    // Google Maps iframe should get title="Google Maps"
    expect($written("#ifrm-maps").attr("title")).toBe("Google Maps");

    // General host iframe should get title="[Host] embedded content"
    expect($written("#ifrm-custom").attr("title")).toBe(
      "Example embedded content",
    );

    // Iframe without src but with name should humanize the name
    expect($written("#ifrm-name").attr("title")).toBe("Chat widget");

    // Iframe without src but with id should humanize the id
    expect($written("#login-form-widget").attr("title")).toBe(
      "Login form widget",
    );

    // Iframe with absolutely no clues gets title="Embedded content"
    expect($written(".no-clues-frame").attr("title")).toBe("Embedded content");

    // Existing title should be preserved and not overridden
    expect($written("#ifrm-existing").attr("title")).toBe("My Video");
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

  it("programmatically maps inputmode attribute to form controls when missing", async () => {
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
      '<input id="inp-email-im" type="email">' +
      '<input id="inp-tel-im" type="tel">' +
      '<input id="inp-number-im" type="number">' +
      '<input id="inp-otp-im" placeholder="Enter OTP Code">' +
      '<input id="inp-cvv-im" name="card_cvv">' +
      '<input id="inp-decimal-im" title="Decimal Amount">' +
      '<input id="inp-url-im" name="website_url">' +
      '<input id="inp-search-im" type="search">' +
      '<input id="inp-existing-im" inputmode="text" type="email">' +
      '<textarea id="txt-ignored-im" placeholder="Enter comments"></textarea>' +
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
        call[1].includes("inp-email-im"),
    );
    expect(htmlWriteCall).toBeDefined();
    const writtenHtml = htmlWriteCall![1] as string;

    const $written = cheerio.load(writtenHtml);

    expect($written("#inp-email-im").attr("inputmode")).toBe("email");
    expect($written("#inp-tel-im").attr("inputmode")).toBe("tel");
    expect($written("#inp-number-im").attr("inputmode")).toBe("numeric");
    expect($written("#inp-otp-im").attr("inputmode")).toBe("numeric");
    expect($written("#inp-cvv-im").attr("inputmode")).toBe("numeric");
    expect($written("#inp-decimal-im").attr("inputmode")).toBe("decimal");
    expect($written("#inp-url-im").attr("inputmode")).toBe("url");
    expect($written("#inp-search-im").attr("inputmode")).toBe("search");
    expect($written("#inp-existing-im").attr("inputmode")).toBe("text");
    expect($written("#txt-ignored-im").attr("inputmode")).toBeUndefined();
  });

  it("programmatically tags and elevates visual loading indicators with role='status' and aria-label", async () => {
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
      '<div id="div-spinner" class="spinner"></div>' +
      '<span id="span-loader" class="btn-loader"></span>' +
      '<div id="div-loading" class="loading"></div>' +
      '<div id="div-skeleton" class="skeleton-screen"></div>' +
      '<div id="div-shimmer" class="shimmer-effect"></div>' +
      '<div id="div-processing" class="processing-indicator"></div>' +
      '<span id="text-loading">Loading...</span>' +
      '<p id="text-processing">  Processing...  </p>' +
      '<div id="div-spinner-text" class="spinner">Please wait</div>' +
      '<div id="div-existing-role" class="spinner" role="log"></div>' +
      '<div id="div-existing-label" class="spinner" aria-label="Authenticating..."></div>' +
      '<div id="div-existing-title" class="spinner" title="Loading data"></div>' +
      '<div id="div-normal">Static content</div>' +
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
        call[1].includes("div-spinner"),
    );
    expect(htmlWriteCall).toBeDefined();
    const writtenHtml = htmlWriteCall![1] as string;

    const $written = cheerio.load(writtenHtml);

    // Empty/textless spinner gets role="status" and aria-label="Loading"
    const divSpinner = $written("#div-spinner");
    expect(divSpinner.attr("role")).toBe("status");
    expect(divSpinner.attr("aria-label")).toBe("Loading");

    // Empty/textless loader gets role="status" and aria-label="Loading"
    const spanLoader = $written("#span-loader");
    expect(spanLoader.attr("role")).toBe("status");
    expect(spanLoader.attr("aria-label")).toBe("Loading");

    // Empty/textless loading gets role="status" and aria-label="Loading"
    const divLoading = $written("#div-loading");
    expect(divLoading.attr("role")).toBe("status");
    expect(divLoading.attr("aria-label")).toBe("Loading");

    // Empty/textless skeleton gets role="status" and aria-label="Loading"
    const divSkeleton = $written("#div-skeleton");
    expect(divSkeleton.attr("role")).toBe("status");
    expect(divSkeleton.attr("aria-label")).toBe("Loading");

    // Empty/textless shimmer gets role="status" and aria-label="Loading"
    const divShimmer = $written("#div-shimmer");
    expect(divShimmer.attr("role")).toBe("status");
    expect(divShimmer.attr("aria-label")).toBe("Loading");

    // Empty/textless processing gets role="status" and aria-label="Loading"
    const divProcessing = $written("#div-processing");
    expect(divProcessing.attr("role")).toBe("status");
    expect(divProcessing.attr("aria-label")).toBe("Loading");

    // Element with "Loading..." text gets role="status" but preserves its text (no aria-label override needed)
    const textLoading = $written("#text-loading");
    expect(textLoading.attr("role")).toBe("status");
    expect(textLoading.attr("aria-label")).toBeUndefined();
    expect(textLoading.text()).toBe("Loading...");

    // Element with "Processing..." text gets role="status" but preserves its text
    const textProcessing = $written("#text-processing");
    expect(textProcessing.attr("role")).toBe("status");
    expect(textProcessing.attr("aria-label")).toBeUndefined();
    expect(textProcessing.text().trim()).toBe("Processing...");

    // Spinner with text gets role="status" but does NOT get fallback aria-label
    const spinnerWithText = $written("#div-spinner-text");
    expect(spinnerWithText.attr("role")).toBe("status");
    expect(spinnerWithText.attr("aria-label")).toBeUndefined();
    expect(spinnerWithText.text()).toBe("Please wait");

    // Existing role is respected and NOT overridden to "status"
    const existingRole = $written("#div-existing-role");
    expect(existingRole.attr("role")).toBe("log");
    expect(existingRole.attr("aria-label")).toBe("Loading");

    // Existing aria-label prevents fallback aria-label="Loading"
    const existingLabel = $written("#div-existing-label");
    expect(existingLabel.attr("role")).toBe("status");
    expect(existingLabel.attr("aria-label")).toBe("Authenticating...");

    // Existing title prevents fallback aria-label="Loading"
    const existingTitle = $written("#div-existing-title");
    expect(existingTitle.attr("role")).toBe("status");
    expect(existingTitle.attr("aria-label")).toBeUndefined();
    expect(existingTitle.attr("title")).toBe("Loading data");

    // Normal content does not get status role or aria-label
    const divNormal = $written("#div-normal");
    expect(divNormal.attr("role")).toBeUndefined();
    expect(divNormal.attr("aria-label")).toBeUndefined();
  });

  it("ensures nested parents without loading class/ID are NOT double-tagged with role='status'", async () => {
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
      '<div id="nested-parent"><span>Loading...</span></div>' +
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
        call[1].includes("nested-parent"),
    );
    expect(htmlWriteCall).toBeDefined();
    const writtenHtml = htmlWriteCall![1] as string;

    const $written = cheerio.load(writtenHtml);

    // Inner span has loading text and no element children, so it gets role="status"
    const innerSpan = $written("#nested-parent span");
    expect(innerSpan.attr("role")).toBe("status");

    // Parent div has element children, so it should NOT be tagged with role="status"
    const parentDiv = $written("#nested-parent");
    expect(parentDiv.attr("role")).toBeUndefined();
  });

  it("excludes false positives like uploader, downloader, reload, and preload from being tagged", async () => {
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
      '<div id="div-uploader" class="file-uploader"></div>' +
      '<span id="span-downloader" id="pdf-downloader"></span>' +
      '<button id="btn-reload" class="reload-btn">Reload page</button>' +
      '<div id="div-preload" class="preload-spinner"></div>' +
      '<span id="text-uploading">Uploading...</span>' +
      '<span id="text-downloading">Downloading file</span>' +
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
        call[1].includes("div-uploader"),
    );
    expect(htmlWriteCall).toBeDefined();
    const writtenHtml = htmlWriteCall![1] as string;

    const $written = cheerio.load(writtenHtml);

    // None of these should be tagged as status or Loading
    expect($written("#div-uploader").attr("role")).toBeUndefined();
    expect($written("#span-downloader").attr("role")).toBeUndefined();
    expect($written("#btn-reload").attr("role")).toBeUndefined();
    expect($written("#div-preload").attr("role")).toBeUndefined();
    expect($written("#text-uploading").attr("role")).toBeUndefined();
    expect($written("#text-downloading").attr("role")).toBeUndefined();
  });
});
