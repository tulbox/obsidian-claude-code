import { Plugin, WorkspaceLeaf, Notice, ItemView } from "obsidian";
import { ClaudeCodeSettings, DEFAULT_SETTINGS, CHAT_VIEW_TYPE } from "./types";
import { ChatView } from "./views/ChatView";
import { ClaudeCodeSettingTab } from "./settings/SettingsTab";
import { logger } from "./utils/Logger";
import { encryptString, decryptString, isEncryptionAvailable } from "./utils/safeStorage";
import * as fs from "fs";
import * as path from "path";

export default class ClaudeCodePlugin extends Plugin {
  settings: ClaudeCodeSettings = DEFAULT_SETTINGS;
  private readonly MAX_CHAT_WINDOWS = 5;

  async onload() {
    await this.loadSettings();

    // Initialize logger with vault path.
    const vaultPath = this.getVaultPath();
    logger.setLogPath(vaultPath);
    logger.info("Plugin", "Claude Code plugin loading", { vaultPath });
    await this.noticeLoadedSkills(vaultPath);

    // Register the chat view.
    this.registerView(CHAT_VIEW_TYPE, (leaf) => new ChatView(leaf, this));

    // Add ribbon icon to toggle chat.
    this.addRibbonIcon("message-square", "Claude Code", () => {
      this.activateChatView();
    });

    // Add command to toggle chat sidebar.
    this.addCommand({
      id: "toggle-chat-sidebar",
      name: "Toggle Chat Sidebar",
      callback: () => {
        this.toggleChatView();
      },
    });

    // Add command to open chat sidebar.
    this.addCommand({
      id: "open-chat-sidebar",
      name: "Open Chat Sidebar",
      callback: () => {
        this.activateChatView();
      },
    });

    // Add command to start new conversation.
    this.addCommand({
      id: "new-conversation",
      name: "New Conversation",
      callback: () => {
        this.startNewConversation();
      },
    });

    // Add command to open new chat window.
    this.addCommand({
      id: "new-chat-window",
      name: "New Chat Window",
      callback: () => {
        this.createNewChatView("tab");
      },
    });

    // Register settings tab.
    this.addSettingTab(new ClaudeCodeSettingTab(this.app, this));

    // Ensure chat view exists on layout ready.
    this.app.workspace.onLayoutReady(() => {
      const existingLeaf = this.getExistingChatLeaf();
      if (existingLeaf) {
        logger.debug("Plugin", "Chat view restored from workspace layout");
      } else {
        // No existing view - create one in the right sidebar.
        logger.debug("Plugin", "Creating chat view (none existed)");
        this.activateChatView();
      }
    });

    logger.info("Plugin", "Claude Code plugin loaded successfully");
  }

  onunload() {
    // detachLeavesOfType triggers onClose() on each ChatView, which calls cancelStream().
    this.app.workspace.detachLeavesOfType(CHAT_VIEW_TYPE);
    logger.info("Plugin", "Claude Code plugin unloaded");
  }

  async loadSettings() {
    const data = await this.loadData();
    this.settings = Object.assign({}, DEFAULT_SETTINGS, data);
    let shouldSave = false;

    // Normalize base URL early.
    this.settings.baseUrl = (this.settings.baseUrl || "").trim();

    // Security migration: Bash can never be persistently always-allowed.
    if (this.settings.alwaysAllowedTools.includes("Bash")) {
      this.settings.alwaysAllowedTools = this.settings.alwaysAllowedTools.filter((tool) => tool !== "Bash");
      logger.warn("Plugin", "Removed legacy Bash entry from always-allowed tools");
      shouldSave = true;
    }

    // Security: enforce base URL validation at load time (not just in UI).
    const baseUrlError = ClaudeCodeSettingTab.validateBaseUrl(
      this.settings.baseUrl,
      this.settings.allowLocalBaseUrl
    );
    if (baseUrlError) {
      logger.warn("Plugin", "Reset invalid base URL from settings", {
        reason: baseUrlError,
      });
      this.settings.baseUrl = "";
      shouldSave = true;
    }

    // Decrypt API key if it was stored encrypted.
    if (this.settings.apiKey) {
      this.settings.apiKey = decryptString(this.settings.apiKey);
      // Migrate: if key was plaintext and encryption is now available, re-save encrypted.
      if (!this.settings.apiKeyEncrypted && isEncryptionAvailable()) {
        logger.info("Plugin", "Migrating API key to encrypted storage");
        shouldSave = true;
      }
    }

    if (shouldSave) {
      await this.saveSettings();
    }
  }

  async saveSettings() {
    // Clone settings for storage, encrypting the API key.
    const dataToSave = { ...this.settings };
    if (dataToSave.apiKey) {
      dataToSave.apiKey = encryptString(dataToSave.apiKey);
      dataToSave.apiKeyEncrypted = isEncryptionAvailable();
    } else {
      dataToSave.apiKeyEncrypted = false;
    }
    await this.saveData(dataToSave);
  }

  private async noticeLoadedSkills(vaultPath: string) {
    const skillsDir = path.join(vaultPath, ".claude", "skills");
    try {
      const entries = await fs.promises.readdir(skillsDir, { withFileTypes: true });
      const skillNames = entries
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name)
        .sort();

      if (skillNames.length === 0) return;

      const previewCount = 5;
      const preview = skillNames.slice(0, previewCount).join(", ");
      const suffix = skillNames.length > previewCount
        ? ` (+${skillNames.length - previewCount} more)`
        : "";

      new Notice(
        `Loaded skills (${skillNames.length}): ${preview}${suffix}`,
        7000
      );
      logger.info("Plugin", "Loaded project skills", { skills: skillNames });
    } catch (error: any) {
      if (error?.code !== "ENOENT") {
        logger.warn("Plugin", "Failed to read project skills directory", {
          dir: skillsDir,
          error: String(error),
        });
      }
    }
  }

  // Get existing chat leaf if any.
  getExistingChatLeaf(): WorkspaceLeaf | null {
    const leaves = this.app.workspace.getLeavesOfType(CHAT_VIEW_TYPE);
    return leaves.length > 0 ? leaves[0] : null;
  }

  // Activate or create the chat view in right sidebar.
  async activateChatView() {
    const existingLeaf = this.getExistingChatLeaf();

    if (existingLeaf) {
      // Reveal existing leaf.
      this.app.workspace.revealLeaf(existingLeaf);
      return;
    }

    // Create new leaf in right sidebar.
    await this.createNewChatView("tab");
  }

  // Create a new chat view window.
  async createNewChatView(mode: "tab" | "split-right" | "split-down" = "tab") {
    // Check window limit.
    const existingLeaves = this.app.workspace.getLeavesOfType(CHAT_VIEW_TYPE);
    if (existingLeaves.length >= this.MAX_CHAT_WINDOWS) {
      new Notice(`Maximum ${this.MAX_CHAT_WINDOWS} chat windows allowed`);
      return;
    }

    let leaf: WorkspaceLeaf | null = null;

    switch (mode) {
      case "tab":
        leaf = this.app.workspace.getRightLeaf(false);
        break;
      case "split-right": {
        const activeLeaf = this.app.workspace.getActiveViewOfType(ItemView)?.leaf;
        if (activeLeaf) {
          leaf = this.app.workspace.createLeafBySplit(activeLeaf, "vertical");
        } else {
          leaf = this.app.workspace.getRightLeaf(false);
        }
        break;
      }
      case "split-down": {
        const currentLeaf = this.app.workspace.getActiveViewOfType(ItemView)?.leaf;
        if (currentLeaf) {
          leaf = this.app.workspace.createLeafBySplit(currentLeaf, "horizontal");
        } else {
          leaf = this.app.workspace.getRightLeaf(false);
        }
        break;
      }
    }

    if (leaf) {
      await leaf.setViewState({
        type: CHAT_VIEW_TYPE,
        active: true,
      });
      this.app.workspace.revealLeaf(leaf);
    }
  }

  // Toggle chat view visibility by collapsing/expanding the right sidebar.
  async toggleChatView() {
    const existingLeaf = this.getExistingChatLeaf();
    const rightSplit = this.app.workspace.rightSplit;

    if (existingLeaf && rightSplit) {
      if (rightSplit.collapsed) {
        // Sidebar is collapsed, expand it and reveal the chat.
        rightSplit.expand();
        this.app.workspace.revealLeaf(existingLeaf);
      } else {
        // Sidebar is visible, collapse it to hide.
        rightSplit.collapse();
      }
    } else if (!existingLeaf) {
      // No chat view exists, create one.
      await this.activateChatView();
    }
  }

  // Start a new conversation.
  async startNewConversation() {
    const leaf = this.getExistingChatLeaf();
    if (leaf && leaf.view instanceof ChatView) {
      leaf.view.startNewConversation();
    } else {
      // Open chat view first, then start new conversation.
      await this.activateChatView();
      // Small delay to ensure view is ready.
      setTimeout(() => {
        const newLeaf = this.getExistingChatLeaf();
        if (newLeaf && newLeaf.view instanceof ChatView) {
          newLeaf.view.startNewConversation();
        }
      }, 100);
    }
  }

  // Check if authentication is configured (API key or env vars).
  isApiKeyConfigured(): boolean {
    return !!(
      this.settings.apiKey ||
      process.env.ANTHROPIC_API_KEY ||
      process.env.CLAUDE_CODE_OAUTH_TOKEN
    );
  }

  // Get the vault path.
  getVaultPath(): string {
    const adapter = this.app.vault.adapter as any;
    return adapter.basePath || "";
  }
}
