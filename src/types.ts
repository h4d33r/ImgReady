export type ImageSyntax = "markdown" | "html" | "wikilink";

export interface ImageReference {
  syntax: ImageSyntax;
  url: string;
  start: number;
  end: number;
  remote: boolean;
  host?: string;
}

export interface ScanResult {
  remote: ImageReference[];
  local: ImageReference[];
  hosts: string[];
}

export type SupportedImageType = "png" | "jpeg" | "gif" | "webp";

export interface DownloadedImage {
  sourceUrl: string;
  host: string;
  bytes: ArrayBuffer;
  type: SupportedImageType;
  mime: string;
}
