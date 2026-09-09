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
      [`${WIN_SETUP_ROOT}/app/src/index.js`]: strToU8(
        'export const AGENT_VERSION = "1.1.3";\nconsole.log(1)\n',
      ),
      [`${WIN_SETUP_ROOT}/START-HERE.txt`]: strToU8("hello"),
    });
    const personalized = personalizeWinSetupZip(base, {
      apiBase: "https://example.com/api",
      agentToken: "jxsa_abc",
      packVersion: "1.1.3",
    });
    expect(personalized.agentVersion).toBe("1.1.3");
    expect(personalized.warning).toBeUndefined();
    const cfg = readZipTextEntry(personalized.zip, `${WIN_SETUP_ROOT}/config.json`);
    expect(cfg).toBeTruthy();
    expect(JSON.parse(cfg!).agentToken).toBe("jxsa_abc");
    expect(JSON.parse(cfg!).packVersion).toBe("1.1.3");
    expect(readZipTextEntry(personalized.zip, `${WIN_SETUP_ROOT}/START-HERE.txt`)).toContain(
      "hello",
    );
  });

  it("allows outdated zip download but warns and stamps honest packVersion", () => {
    const base = zipSync({
      [`${WIN_SETUP_ROOT}/Install JustX Sync Agent.cmd`]: strToU8("@echo off\n"),
      [`${WIN_SETUP_ROOT}/runtime/node.exe`]: strToU8("fake-node"),
      [`${WIN_SETUP_ROOT}/app/src/index.js`]: strToU8(
        'export const AGENT_VERSION = "1.1.0";\n',
      ),
    });
    const personalized = personalizeWinSetupZip(base, {
      apiBase: "https://example.com/api",
      agentToken: "jxsa_abc",
      packVersion: "1.1.3",
    });
    expect(personalized.agentVersion).toBe("1.1.0");
    expect(personalized.warning).toMatch(/agent 1\.1\.0.*expects 1\.1\.3/i);
    const cfg = JSON.parse(readZipTextEntry(personalized.zip, `${WIN_SETUP_ROOT}/config.json`)!);
    expect(cfg.packVersion).toBe("1.1.0");
  });
});
