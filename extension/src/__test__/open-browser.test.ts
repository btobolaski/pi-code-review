import { strict as assert } from "node:assert";
import { describe, it } from "node:test";

import { browserCommand } from "../open-browser.js";

describe("browserCommand", () => {
  it("uses `open` on macOS", () => {
    assert.deepEqual(browserCommand("http://x", "darwin"), {
      command: "open",
      args: ["http://x"],
    });
  });
  it("uses `cmd /c start` on Windows", () => {
    assert.deepEqual(browserCommand("http://x", "win32"), {
      command: "cmd",
      args: ["/c", "start", "", "http://x"],
    });
  });
  it("uses `xdg-open` on Linux and other platforms", () => {
    assert.deepEqual(browserCommand("http://x", "linux"), {
      command: "xdg-open",
      args: ["http://x"],
    });
    assert.deepEqual(browserCommand("http://x", "freebsd" as NodeJS.Platform), {
      command: "xdg-open",
      args: ["http://x"],
    });
  });
});
