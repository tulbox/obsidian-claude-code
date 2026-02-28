import { Modal, App, setIcon } from "obsidian";

/**
 * Modal shown when a tool call rate limit is hit.
 * User can continue (raising the limit) or stop the query.
 */
export class RateLimitModal extends Modal {
  private toolName: string;
  private count: number;
  private limit: number;
  private onContinue: () => void;
  private onStop: () => void;
  private resolved = false;

  constructor(
    app: App,
    toolName: string,
    count: number,
    limit: number,
    onContinue: () => void,
    onStop: () => void
  ) {
    super(app);
    this.toolName = toolName;
    this.count = count;
    this.limit = limit;
    this.onContinue = onContinue;
    this.onStop = onStop;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("claude-code-rate-limit-modal");

    // Header with warning icon.
    const headerEl = contentEl.createDiv({ cls: "claude-code-permission-header" });
    const iconEl = headerEl.createSpan({ cls: "claude-code-permission-icon" });
    setIcon(iconEl, "alert-triangle");
    iconEl.addClass("risk-high");
    headerEl.createEl("h2", { text: "Tool Call Limit Reached" });

    // Description.
    const descEl = contentEl.createDiv({ cls: "claude-code-permission-desc" });
    descEl.setText(
      `Claude has used the "${this.toolName}" tool ${this.count} times this query (limit: ${this.limit}). ` +
      `This may indicate a runaway loop or prompt injection. Continue at your own risk.`
    );

    // Buttons.
    const buttonsEl = contentEl.createDiv({ cls: "claude-code-permission-buttons" });

    const stopBtn = buttonsEl.createEl("button", { cls: "claude-code-permission-deny" });
    stopBtn.setText("Stop");
    stopBtn.addEventListener("click", () => {
      this.resolveStop();
      this.close();
    });

    const continueBtn = buttonsEl.createEl("button", { cls: "claude-code-permission-approve" });
    continueBtn.setText("Continue");
    continueBtn.addEventListener("click", () => {
      this.resolveContinue();
      this.close();
    });

    // Focus stop button for safety.
    stopBtn.focus();
  }

  onClose() {
    // Treat ESC/overlay close as stop for safety and to resolve pending promises.
    this.resolveStop();
    const { contentEl } = this;
    contentEl.empty();
  }

  private resolveContinue() {
    if (this.resolved) return;
    this.resolved = true;
    this.onContinue();
  }

  private resolveStop() {
    if (this.resolved) return;
    this.resolved = true;
    this.onStop();
  }
}
