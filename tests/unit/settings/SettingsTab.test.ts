import { describe, it, expect } from "vitest";

import { ClaudeCodeSettingTab } from "../../../src/settings/SettingsTab";

describe("SettingsTab base URL validation", () => {
  it("allows empty base URL", () => {
    expect(ClaudeCodeSettingTab.validateBaseUrl("")).toBeNull();
  });

  it("rejects invalid URL format", () => {
    expect(ClaudeCodeSettingTab.validateBaseUrl("not-a-url")).toBe("Invalid URL format");
  });

  it("rejects non-https URLs", () => {
    expect(ClaudeCodeSettingTab.validateBaseUrl("http://api.anthropic.com")).toBe(
      "Only HTTPS URLs are allowed"
    );
  });

  it("rejects localhost when developer mode is disabled", () => {
    expect(ClaudeCodeSettingTab.validateBaseUrl("https://localhost:8443")).toBe(
      "Localhost URLs require Developer Mode to be enabled"
    );
  });

  it("allows localhost when developer mode is enabled", () => {
    expect(ClaudeCodeSettingTab.validateBaseUrl("https://127.0.0.1:8443", true)).toBeNull();
  });

  it("allows standard https endpoints", () => {
    expect(ClaudeCodeSettingTab.validateBaseUrl("https://api.anthropic.com")).toBeNull();
  });
});
