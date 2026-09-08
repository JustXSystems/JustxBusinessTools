import { describe, expect, it } from "vitest";
import { zipSync, strToU8 } from "fflate";
import {
  buildAgentConfigJson,
  personalizeWinSetupZip,
  readZipTextEntry,
  WIN_SETUP_ROOT,
} from "@/lib/artifact-delivery/win-setup-pack";

describe("win-setup-pack", () => {
  it("builds config json with token", () => {
    const json = buildAgentConfigJson({
      apiBase: "https://example.com/jbt/api",
      agentToken: "jxsa_testtoken",
      downloadFolder: "\\\\server\\share",
    });
    const parsed = JSON.parse(json);
    expect(parsed.agentToken).toBe("jxsa_testtoken");
    expect(parsed.apiBase).toContain("/api");
    expect(parsed.downloadFolder).toContain("server");
  });

  it("injects config.json into a minimal win setup zip", () => {
    const base = zipSync({
      [`${WIN_SETUP_ROOT}/Install JustX Sync Agent.cmd`]: strToU8("@echo off\n"),
      [`${WIN_SETUP_ROOT}/runtime/node.exe`]: strToU8("fake-node"),
      [`${WIN_SETUP_ROOT}/app/src/index.js`]: strToU8("console.log(1)"),
      [`${WIN_SETUP_ROOT}/START-HERE.txt`]: strToU8("hello"),
    });
    const personalized = personalizeWinSetupZip(base, {
      apiBase: "https://example.com/api",
      agentToken: "jxsa_abc",
    });
    const cfg = readZipTextEntry(personalized, `${WIN_SETUP_ROOT}/config.json`);
    expect(cfg).toBeTruthy();
    expect(JSON.parse(cfg!).agentToken).toBe("jxsa_abc");
    expect(readZipTextEntry(personalized, `${WIN_SETUP_ROOT}/START-HERE.txt`)).toContain("hello");
  });
});
