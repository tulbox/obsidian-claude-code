import { App, PluginSettingTab, Setting } from "obsidian";
import type ClaudeCodePlugin from "../main";
import { isEncryptionAvailable } from "../utils/safeStorage";

export class ClaudeCodeSettingTab extends PluginSettingTab {
  plugin: ClaudeCodePlugin;

  constructor(app: App, plugin: ClaudeCodePlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  // Validate base URL: HTTPS only. Localhost requires developer mode.
  static validateBaseUrl(url: string, allowLocalBaseUrl = false): string | null {
    const trimmed = url.trim();
    if (!trimmed) return null;

    try {
      const parsed = new URL(trimmed);
      if (parsed.protocol !== "https:") return "Only HTTPS URLs are allowed";
      const isLocalhost = parsed.hostname === "localhost"
        || parsed.hostname === "127.0.0.1"
        || parsed.hostname === "::1";
      if (!allowLocalBaseUrl && isLocalhost) {
        return "Localhost URLs require Developer Mode to be enabled";
      }
      return null;
    } catch {
      return "Invalid URL format";
    }
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    containerEl.createEl("h2", { text: "Claude Code Settings" });

    // API Configuration Section.
    containerEl.createEl("h3", { text: "Authentication" });

    // Check for environment variables.
    const hasEnvApiKey = !!process.env.ANTHROPIC_API_KEY;
    const hasOAuthToken = !!process.env.CLAUDE_CODE_OAUTH_TOKEN;

    if (hasEnvApiKey || hasOAuthToken) {
      const envNotice = containerEl.createDiv({ cls: "claude-code-env-notice" });
      envNotice.createEl("p", {
        text: hasOAuthToken
          ? "Using Claude Max subscription via CLAUDE_CODE_OAUTH_TOKEN environment variable."
          : "Using API key from ANTHROPIC_API_KEY environment variable.",
        cls: "mod-success",
      });
    }

    new Setting(containerEl)
      .setName("API Key")
      .setDesc(
        hasEnvApiKey || hasOAuthToken
          ? "Optional: Override the environment variable with a specific key"
          : "Your Anthropic API key. Get one at console.anthropic.com"
      )
      .addText((text) =>
        text
          .setPlaceholder(hasEnvApiKey ? "(using env var)" : "sk-ant-...")
          .setValue(this.plugin.settings.apiKey)
          .onChange(async (value) => {
            this.plugin.settings.apiKey = value;
            await this.plugin.saveSettings();
          })
      )
      .then((setting) => {
        // Make the input a password field.
        const inputEl = setting.controlEl.querySelector("input");
        if (inputEl) {
          inputEl.type = "password";
        }
      });

    // Encryption status for API key.
    if (this.plugin.settings.apiKey) {
      const encStatusEl = containerEl.createDiv({ cls: "claude-code-encryption-status" });
      if (isEncryptionAvailable()) {
        encStatusEl.createEl("p", {
          text: "API key is encrypted via OS keychain (Electron safeStorage).",
          cls: "mod-success",
        });
      } else {
        encStatusEl.createEl("p", {
          text: "Warning: API key is stored in plaintext. OS keychain encryption is not available on this system.",
          cls: "mod-warning",
        });
      }
    }

    // Check for environment variables.
    const hasEnvBaseUrl = !!process.env.ANTHROPIC_BASE_URL;

    new Setting(containerEl)
      .setName("Base URL")
      .setDesc(
        hasEnvBaseUrl
          ? "Optional: Override the environment variable with a specific base URL"
          : "Custom API base URL (e.g., for proxy or custom endpoint)"
      )
      .addText((text) =>
        text
          .setPlaceholder(hasEnvBaseUrl ? "(using env var)" : "https://api.anthropic.com")
          .setValue(this.plugin.settings.baseUrl)
          .onChange(async (value) => {
            if (value) {
              const error = ClaudeCodeSettingTab.validateBaseUrl(
                value,
                this.plugin.settings.allowLocalBaseUrl
              );
              if (error) {
                // Show validation error but still save (user may be in-progress typing).
                text.inputEl.style.borderColor = "var(--text-error)";
                text.inputEl.title = error;
                return;
              }
              text.inputEl.style.borderColor = "";
              text.inputEl.title = "";
            }
            this.plugin.settings.baseUrl = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Developer Mode (local base URL)")
      .setDesc("Allow localhost/127.0.0.1 custom API base URLs. Keep disabled unless you trust your local proxy.")
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.allowLocalBaseUrl).onChange(async (value) => {
          this.plugin.settings.allowLocalBaseUrl = value;

          const baseUrlError = ClaudeCodeSettingTab.validateBaseUrl(
            this.plugin.settings.baseUrl,
            value
          );
          if (baseUrlError) {
            this.plugin.settings.baseUrl = "";
          }

          await this.plugin.saveSettings();
          this.display();
        })
      );

    // Warning for custom base URLs.
    if (this.plugin.settings.baseUrl && this.plugin.settings.baseUrl !== "https://api.anthropic.com") {
      const warningEl = containerEl.createDiv({ cls: "claude-code-base-url-warning" });
      warningEl.createEl("p", {
        text: "Warning: All prompts and vault content will be sent to this custom endpoint.",
        cls: "mod-warning",
      });
    }

    // Claude Max subscription info.
    const authInfoEl = containerEl.createDiv({ cls: "claude-code-auth-info" });
    authInfoEl.createEl("details", {}, (details) => {
      details.createEl("summary", { text: "Using Claude Max subscription?" });
      details.createEl("p", {
        text: "If you have a Claude Pro or Max subscription, you can use it instead of an API key:",
      });
      const steps = details.createEl("ol");
      steps.createEl("li", {
        text: "Run 'claude setup-token' in your terminal to authenticate with your subscription",
      });
      steps.createEl("li", {
        text: "This creates a CLAUDE_CODE_OAUTH_TOKEN environment variable",
      });
      steps.createEl("li", { text: "Restart Obsidian to pick up the token" });
      details.createEl("p", {
        text: "Note: If ANTHROPIC_API_KEY is also set, the API key takes precedence.",
        cls: "mod-warning",
      });
    });

    new Setting(containerEl)
      .setName("Model")
      .setDesc("Claude model to use for conversations")
      .addDropdown((dropdown) =>
        dropdown
          .addOption("sonnet", "Sonnet (Faster)")
          .addOption("opus", "Opus (More capable)")
          .addOption("haiku", "Haiku (Fastest)")
          .setValue(this.plugin.settings.model || "sonnet")
          .onChange(async (value) => {
            this.plugin.settings.model = value;
            await this.plugin.saveSettings();
          })
      );

    // Permissions Section.
    containerEl.createEl("h3", { text: "Permissions" });

    new Setting(containerEl)
      .setName("Auto-approve vault reads")
      .setDesc("Automatically allow Claude to read files in your vault")
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.autoApproveVaultReads).onChange(async (value) => {
          this.plugin.settings.autoApproveVaultReads = value;
          await this.plugin.saveSettings();
        })
      );

    new Setting(containerEl)
      .setName("Auto-approve vault writes")
      .setDesc("When enabled, Claude can write and edit files in your vault without confirmation. Disabled by default for security.")
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.autoApproveVaultWrites).onChange(async (value) => {
          this.plugin.settings.autoApproveVaultWrites = value;
          await this.plugin.saveSettings();
        })
      );

    new Setting(containerEl)
      .setName("Require approval for commands")
      .setDesc("Require explicit approval before executing shell commands")
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.requireBashApproval).onChange(async (value) => {
          this.plugin.settings.requireBashApproval = value;
          await this.plugin.saveSettings();
        })
      );

    // Allowed Obsidian commands for execute_command tool.
    new Setting(containerEl)
      .setName("Allowed Obsidian commands")
      .setDesc("Command IDs that Claude can execute (one per line). Use list_commands to discover IDs.")
      .addTextArea((textarea) =>
        textarea
          .setPlaceholder("editor:toggle-bold\napp:go-back")
          .setValue((this.plugin.settings.allowedCommands || []).join("\n"))
          .onChange(async (value) => {
            this.plugin.settings.allowedCommands = value
              .split("\n")
              .map((s) => s.trim())
              .filter((s) => s.length > 0);
            await this.plugin.saveSettings();
          })
      )
      .then((setting) => {
        const textarea = setting.controlEl.querySelector("textarea");
        if (textarea) {
          textarea.rows = 6;
          textarea.style.width = "100%";
          textarea.style.fontFamily = "monospace";
          textarea.style.fontSize = "12px";
        }
      });

    // Always-allowed tools section.
    if (this.plugin.settings.alwaysAllowedTools.length > 0) {
      const alwaysAllowedEl = containerEl.createDiv({ cls: "claude-code-always-allowed" });
      alwaysAllowedEl.createEl("h4", { text: "Always Allowed Tools" });
      alwaysAllowedEl.createEl("p", {
        text: "These tools have been permanently approved. Click to remove.",
        cls: "setting-item-description",
      });

      const toolsList = alwaysAllowedEl.createDiv({ cls: "claude-code-tools-list" });
      for (const tool of this.plugin.settings.alwaysAllowedTools) {
        const toolChip = toolsList.createDiv({ cls: "claude-code-tool-chip" });
        toolChip.createSpan({ text: tool });
        const removeBtn = toolChip.createEl("button", { text: "×", cls: "claude-code-tool-chip-remove" });
        removeBtn.addEventListener("click", async () => {
          this.plugin.settings.alwaysAllowedTools = this.plugin.settings.alwaysAllowedTools.filter(
            (t) => t !== tool
          );
          await this.plugin.saveSettings();
          this.display(); // Re-render settings.
        });
      }
    }

    // Agent SDK Section.
    containerEl.createEl("h3", { text: "Agent Settings" });

    new Setting(containerEl)
      .setName("Max budget per session")
      .setDesc("Maximum cost in USD before requiring confirmation to continue")
      .addText((text) =>
        text
          .setPlaceholder("10.00")
          .setValue(String(this.plugin.settings.maxBudgetPerSession))
          .onChange(async (value) => {
            const parsed = parseFloat(value);
            if (!isNaN(parsed) && parsed > 0) {
              this.plugin.settings.maxBudgetPerSession = parsed;
              await this.plugin.saveSettings();
            }
          })
      );

    new Setting(containerEl)
      .setName("Max turns per query")
      .setDesc("Maximum conversation turns (tool use cycles) per query")
      .addText((text) =>
        text
          .setPlaceholder("50")
          .setValue(String(this.plugin.settings.maxTurns))
          .onChange(async (value) => {
            const parsed = parseInt(value, 10);
            if (!isNaN(parsed) && parsed > 0) {
              this.plugin.settings.maxTurns = parsed;
              await this.plugin.saveSettings();
            }
          })
      );

    // About Section.
    containerEl.createEl("h3", { text: "About" });

    const aboutEl = containerEl.createDiv({ cls: "claude-code-settings-about" });
    aboutEl.createEl("p", {
      text: "Claude Code brings AI-powered assistance to your Obsidian vault using the Claude Agent SDK. Ask questions, automate tasks, search notes semantically, and get help with your knowledge base.",
    });
    aboutEl.createEl("p", {
      text: "Features: Built-in tools (Read, Write, Bash, Grep), skill loading from .claude/skills/, Obsidian-specific tools (open files, run commands), and semantic vault search.",
    });
  }
}
