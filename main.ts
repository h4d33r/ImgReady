import { Notice, Plugin, TFile } from "obsidian";
import { scanImages, replaceRemoteUrls } from "./src/imageScanner";
import { downloadImage } from "./src/downloader";
import { encodeVaultLinkTarget, saveDownloadedImage } from "./src/attachmentManager";
import { ImgReadySettingTab, sanitizeSettings, type ImgReadySettings } from "./src/settings";
import { InspectImagesModal } from "./src/inspectModal";
import type { DownloadedImage, ScanResult } from "./src/types";

export default class ImgReadyPlugin extends Plugin {
  settings!: ImgReadySettings;

  async onload(): Promise<void> {
    await this.loadSettings();
    this.addSettingTab(new ImgReadySettingTab(this.app, this));
    this.addRibbonIcon("image-down", "Inspect images with ImgReady", () => void this.inspectCurrentNote());
    this.addCommand({
      id: "inspect-current-note-images",
      name: "Inspect images in current note",
      callback: () => void this.inspectCurrentNote()
    });
  }

  async loadSettings(): Promise<void> {
    const saved = await this.loadData() as Partial<ImgReadySettings> | null;
    this.settings = sanitizeSettings(saved);
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }

  private async inspectCurrentNote(): Promise<void> {
    const file = this.app.workspace.getActiveFile();
    if (!(file instanceof TFile) || file.extension !== "md") {
      new Notice("Open a Markdown note first.");
      return;
    }
    const text = await this.app.vault.cachedRead(file);
    new InspectImagesModal(this.app, this, file, scanImages(text)).open();
  }

  async localizeRemoteImages(file: TFile, scan: ScanResult): Promise<void> {
    const uniqueUrls = [...new Set(scan.remote.map((reference) => reference.url))];
    if (uniqueUrls.length === 0) {
      new Notice("No remote images found.");
      return;
    }
    if (uniqueUrls.length > this.settings.maxImagesPerBatch) {
      throw new Error(`This note contains ${uniqueUrls.length} unique remote images, above the configured batch limit of ${this.settings.maxImagesPerBatch}.`);
    }

    const maxFileBytes = Math.floor(this.settings.maxFileMb * 1024 * 1024);
    const maxBatchBytes = Math.floor(this.settings.maxBatchMb * 1024 * 1024);
    const downloads: DownloadedImage[] = [];
    let batchBytes = 0;

    for (const url of uniqueUrls) {
      const image = await downloadImage(url, {
        trustedHosts: this.settings.trustedHosts,
        allowNonStandardHttpsPorts: this.settings.allowNonStandardHttpsPorts
      }, {
        maxFileBytes,
        maxDimension: this.settings.maxDimensionPx,
        maxPixels: Math.floor(this.settings.maxMegapixels * 1_000_000),
        requestTimeoutMs: this.settings.requestTimeoutSeconds * 1000
      });

      batchBytes += image.bytes.byteLength;
      if (batchBytes > maxBatchBytes) {
        throw new Error(`Batch exceeds the configured ${this.settings.maxBatchMb} MB limit.`);
      }
      downloads.push(image);
    }

    const replacements = new Map<string, string>();
    for (const image of downloads) {
      const path = await saveDownloadedImage(this.app.vault, image, this.settings.attachmentRoot, file.basename);
      const attachment = this.app.vault.getFileByPath(path);
      if (!attachment) throw new Error(`Attachment was created but could not be resolved: ${path}`);

      const linkText = this.app.metadataCache.fileToLinktext(attachment, file.path, true);
      replacements.set(image.sourceUrl, encodeVaultLinkTarget(linkText));
    }

    await this.app.vault.process(file, (current) => replaceRemoteUrls(current, replacements));
    new Notice(`ImgReady localized ${downloads.length} remote image${downloads.length === 1 ? "" : "s"}.`);
  }
}
