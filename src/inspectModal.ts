import { Modal, Notice, Setting, type App, type TFile } from "obsidian";
import type ImgReadyPlugin from "../main";
import type { ScanResult } from "./types";

export class InspectImagesModal extends Modal {
  constructor(
    app: App,
    private readonly plugin: ImgReadyPlugin,
    private readonly file: TFile,
    private readonly scan: ScanResult
  ) {
    super(app);
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl("h2", { text: "ImgReady — current note" });
    contentEl.createEl("p", { text: `Remote images: ${this.scan.remote.length} · Local images: ${this.scan.local.length}` });

    contentEl.createEl("h3", { text: "Hosts that would be contacted" });
    if (this.scan.hosts.length === 0) contentEl.createEl("p", { text: "None." });
    else {
      const list = contentEl.createEl("ul");
      for (const host of this.scan.hosts) {
        const trusted = this.plugin.settings.trustedHosts.includes(host);
        list.createEl("li", { text: `${host} — ${trusted ? "trusted" : "not trusted"}` });
      }
    }

    const untrusted = this.scan.hosts.filter((host) => !this.plugin.settings.trustedHosts.includes(host));
    if (untrusted.length > 0) {
      new Setting(contentEl)
        .setName("Trust hosts shown above")
        .setDesc("Adds these exact hosts to ImgReady's allowlist. This does not start a download.")
        .addButton((button) => button.setButtonText("Trust shown hosts").onClick(async () => {
          this.plugin.settings.trustedHosts = [...new Set([...this.plugin.settings.trustedHosts, ...untrusted])].sort();
          await this.plugin.saveSettings();
          new Notice("Hosts trusted. Review the list, then run ImgReady again to localize.");
          this.close();
        }));
    } else if (this.scan.remote.length > 0) {
      new Setting(contentEl)
        .setName("Localize remote images")
        .setDesc("Downloads only the URLs listed in this note after security checks, then updates their links.")
        .addButton((button) => button.setCta().setButtonText("Localize remote images").onClick(async () => {
          button.setDisabled(true);
          try {
            await this.plugin.localizeRemoteImages(this.file, this.scan);
            this.close();
          } catch (error) {
            new Notice(`ImgReady stopped: ${error instanceof Error ? error.message : String(error)}`, 8000);
            button.setDisabled(false);
          }
        }));
    }
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
