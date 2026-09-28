import { App, Notice, PluginSettingTab, Setting } from "obsidian";
import type ImgReadyPlugin from "../main";
import { validateAttachmentRoot } from "./attachmentManager";
import { normalizeTrustedHosts } from "./security";

export interface ImgReadySettings {
  trustedHosts: string[];
  maxFileMb: number;
  maxBatchMb: number;
  maxImagesPerBatch: number;
  maxDimensionPx: number;
  maxMegapixels: number;
  requestTimeoutSeconds: number;
  attachmentRoot: string;
  allowNonStandardHttpsPorts: boolean;
}

export const DEFAULT_SETTINGS: ImgReadySettings = {
  trustedHosts: [],
  maxFileMb: 10,
  maxBatchMb: 25,
  maxImagesPerBatch: 25,
  maxDimensionPx: 16384,
  maxMegapixels: 40,
  requestTimeoutSeconds: 20,
  attachmentRoot: "Attachments",
  allowNonStandardHttpsPorts: false
};

function bounded(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) && parsed >= min && parsed <= max ? parsed : fallback;
}

export function sanitizeSettings(saved: Partial<ImgReadySettings> | null | undefined): ImgReadySettings {
  let attachmentRoot = DEFAULT_SETTINGS.attachmentRoot;
  try {
    attachmentRoot = validateAttachmentRoot(saved?.attachmentRoot ?? DEFAULT_SETTINGS.attachmentRoot);
  } catch {}

  return {
    trustedHosts: normalizeTrustedHosts(Array.isArray(saved?.trustedHosts) ? saved.trustedHosts : []),
    maxFileMb: bounded(saved?.maxFileMb, DEFAULT_SETTINGS.maxFileMb, 0.1, 100),
    maxBatchMb: bounded(saved?.maxBatchMb, DEFAULT_SETTINGS.maxBatchMb, 1, 500),
    maxImagesPerBatch: Math.floor(bounded(saved?.maxImagesPerBatch, DEFAULT_SETTINGS.maxImagesPerBatch, 1, 100)),
    maxDimensionPx: Math.floor(bounded(saved?.maxDimensionPx, DEFAULT_SETTINGS.maxDimensionPx, 512, 32768)),
    maxMegapixels: bounded(saved?.maxMegapixels, DEFAULT_SETTINGS.maxMegapixels, 1, 100),
    requestTimeoutSeconds: Math.floor(bounded(saved?.requestTimeoutSeconds, DEFAULT_SETTINGS.requestTimeoutSeconds, 5, 60)),
    attachmentRoot,
    allowNonStandardHttpsPorts: saved?.allowNonStandardHttpsPorts === true
  };
}

export class ImgReadySettingTab extends PluginSettingTab {
  constructor(app: App, private readonly plugin: ImgReadyPlugin) {
    super(app, plugin);
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl("h2", { text: "ImgReady" });
    containerEl.createEl("p", { text: "ImgReady makes network requests only when you explicitly localize remote images." });

    containerEl.createEl("h3", { text: "Attachments" });
    new Setting(containerEl)
      .setName("Attachment root")
      .setDesc("Relative vault folder. Each note gets its own subfolder. Hidden folders and '..' paths are blocked.")
      .addText((text) => text.setPlaceholder("Attachments").setValue(this.plugin.settings.attachmentRoot).onChange(async (value) => {
        try {
          this.plugin.settings.attachmentRoot = validateAttachmentRoot(value);
          await this.plugin.saveSettings();
        } catch (error) {
          new Notice(error instanceof Error ? error.message : String(error), 5000);
        }
      }));

    containerEl.createEl("h3", { text: "Trusted hosts" });
    new Setting(containerEl)
      .setName("Trusted image hosts")
      .setDesc("Exact hostnames only, one per line. Trust does not automatically include subdomains.")
      .addTextArea((text) => text.setPlaceholder("images.example.com\ncdn.example.net").setValue(this.plugin.settings.trustedHosts.join("\n")).onChange(async (value) => {
        this.plugin.settings.trustedHosts = normalizeTrustedHosts(value.split(/\r?\n|,/));
        await this.plugin.saveSettings();
      }));

    new Setting(containerEl)
      .setName("Clear trusted hosts")
      .setDesc("Removes all hosts from ImgReady's allowlist. No files are changed.")
      .addButton((button) => button.setWarning().setButtonText("Clear allowlist").onClick(async () => {
        this.plugin.settings.trustedHosts = [];
        await this.plugin.saveSettings();
        new Notice("ImgReady trusted-host allowlist cleared.");
        this.display();
      }));

    containerEl.createEl("h3", { text: "Download limits" });
    const numberSetting = (
      name: string,
      desc: string,
      value: number,
      min: number,
      max: number,
      save: (value: number) => void
    ): void => {
      new Setting(containerEl).setName(name).setDesc(desc)
        .addText((text) => text.setValue(String(value)).onChange(async (raw) => {
          const parsed = Number(raw);
          if (Number.isFinite(parsed) && parsed >= min && parsed <= max) {
            save(parsed);
            await this.plugin.saveSettings();
          }
        }));
    };

    numberSetting("Maximum image size", "Per-file download limit in MB. Allowed range: 0.1–100 MB.",
      this.plugin.settings.maxFileMb, 0.1, 100, (v) => { this.plugin.settings.maxFileMb = v; });
    numberSetting("Maximum batch size", "Total bytes allowed during one localization action. Allowed range: 1–500 MB.",
      this.plugin.settings.maxBatchMb, 1, 500, (v) => { this.plugin.settings.maxBatchMb = v; });
    numberSetting("Maximum images per batch", "Caps unique remote images contacted in one action. Allowed range: 1–100.",
      this.plugin.settings.maxImagesPerBatch, 1, 100, (v) => { this.plugin.settings.maxImagesPerBatch = Math.floor(v); });
    numberSetting("Request timeout", "Absolute timeout per image request in seconds. Allowed range: 5–60.",
      this.plugin.settings.requestTimeoutSeconds, 5, 60, (v) => { this.plugin.settings.requestTimeoutSeconds = Math.floor(v); });

    containerEl.createEl("h3", { text: "Image validation" });
    numberSetting("Maximum image dimension", "Rejects images wider or taller than this many pixels. Allowed range: 512–32768.",
      this.plugin.settings.maxDimensionPx, 512, 32768, (v) => { this.plugin.settings.maxDimensionPx = Math.floor(v); });
    numberSetting("Maximum megapixels", "Rejects very large decoded image dimensions. Allowed range: 1–100 MP.",
      this.plugin.settings.maxMegapixels, 1, 100, (v) => { this.plugin.settings.maxMegapixels = v; });

    containerEl.createEl("h3", { text: "Network security" });
    new Setting(containerEl)
      .setName("Allow non-standard HTTPS ports")
      .setDesc("Off by default. Leave disabled unless an image host genuinely uses an HTTPS port other than 443.")
      .addToggle((toggle) => toggle.setValue(this.plugin.settings.allowNonStandardHttpsPorts).onChange(async (value) => {
        this.plugin.settings.allowNonStandardHttpsPorts = value;
        await this.plugin.saveSettings();
      }));

    const status = containerEl.createEl("div", { cls: "imgready-security-status" });
    status.createEl("h3", { text: "Security defaults" });
    const list = status.createEl("ul");
    [
      "HTTPS only",
      "Redirects blocked",
      "Private, loopback, link-local, reserved and internal destinations blocked",
      "DNS destination checked and connection pinned to the validated address",
      "PNG, JPEG, GIF and WebP only; SVG rejected",
      "MIME type, file signature and image dimensions validated",
      "No telemetry and no background network traffic"
    ].forEach((item) => list.createEl("li", { text: item }));
  }
}
