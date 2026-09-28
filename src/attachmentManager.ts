import { normalizePath, TFolder, type Vault } from "obsidian";
import { extensionFor } from "./fileValidation";
import type { DownloadedImage } from "./types";

function isWindowsReservedName(value: string): boolean {
  return /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i.test(value);
}

function safeSegment(value: string): string {
  const cleaned = value
    .replace(/[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/g, "")
    .replace(/[\\/:*?"<>|#\[\]^]/g, "-")
    .replace(/\s+/g, " ")
    .replace(/[. ]+$/g, "")
    .trim();

  const limited = cleaned.slice(0, 80) || "image";
  return isWindowsReservedName(limited) ? `_${limited}` : limited;
}

export function encodeVaultLinkTarget(linkText: string): string {
  return linkText
    .split("/")
    .map((segment) => encodeURIComponent(segment)
      .replace(/'/g, "%27")
      .replace(/\(/g, "%28")
      .replace(/\)/g, "%29"))
    .join("/");
}

export function validateAttachmentRoot(value: string): string {
  const raw = value.trim().replace(/\\/g, "/");
  if (!raw) return "Attachments";

  if (raw.startsWith("/") || raw.startsWith("~") || /^[A-Za-z]:\//.test(raw)) {
    throw new Error("Attachment root must be a relative folder inside the vault.");
  }

  const parts = raw.split("/");
  if (parts.some((part) => !part || part === "." || part === "..")) {
    throw new Error("Attachment root cannot contain empty, '.' or '..' path segments.");
  }
  if (parts.some((part) => part.startsWith("."))) {
    throw new Error("Attachment root cannot target hidden/config folders.");
  }
  if (parts.some((part) => /[\u0000-\u001f\u007f<>:"|?*]/.test(part))) {
    throw new Error("Attachment root contains unsupported path characters.");
  }
  if (parts.some((part) => /[. ]$/.test(part) || isWindowsReservedName(part))) {
    throw new Error("Attachment root contains a Windows-reserved or invalid path segment.");
  }

  return normalizePath(parts.join("/"));
}

function sourceBaseName(rawUrl: string): string {
  try {
    const url = new URL(rawUrl);
    const last = decodeURIComponent(url.pathname.split("/").filter(Boolean).pop() ?? "image");
    return safeSegment(last.replace(/\.[^.]+$/, ""));
  } catch {
    return "image";
  }
}

async function ensureFolder(vault: Vault, path: string): Promise<void> {
  const parts = normalizePath(path).split("/").filter(Boolean);
  let current = "";
  for (const part of parts) {
    current = current ? `${current}/${part}` : part;
    const existing = vault.getAbstractFileByPath(current);
    if (!existing) await vault.createFolder(current);
    else if (!(existing instanceof TFolder)) {
      throw new Error(`Cannot create attachment folder because a file already exists at: ${current}`);
    }
  }
}

export async function saveDownloadedImage(
  vault: Vault,
  image: DownloadedImage,
  attachmentRoot: string,
  noteBaseName: string
): Promise<string> {
  const root = validateAttachmentRoot(attachmentRoot);
  const folder = normalizePath(`${root}/${safeSegment(noteBaseName)}`);
  await ensureFolder(vault, folder);

  const ext = extensionFor(image.type);
  const base = sourceBaseName(image.sourceUrl);
  let index = 0;
  let path: string;

  do {
    const suffix = index === 0 ? "" : `-${index + 1}`;
    path = normalizePath(`${folder}/${base}${suffix}.${ext}`);
    index++;
  } while (vault.getAbstractFileByPath(path));

  await vault.createBinary(path, image.bytes);
  return path;
}
