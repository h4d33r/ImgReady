import https from "https";
import type { LookupFunction } from "net";
import { resolveSafeDestination, type UrlSecurityPolicy } from "./security";
import { validateImagePayload } from "./fileValidation";
import type { DownloadedImage } from "./types";

export interface DownloadLimits {
  maxFileBytes: number;
  maxDimension: number;
  maxPixels: number;
  requestTimeoutMs: number;
}

export async function downloadImage(rawUrl: string, policy: UrlSecurityPolicy, limits: DownloadLimits): Promise<DownloadedImage> {
  const destination = await new Promise<Awaited<ReturnType<typeof resolveSafeDestination>>>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("DNS resolution exceeded the request timeout.")), limits.requestTimeoutMs);
    void resolveSafeDestination(rawUrl, policy).then(
      (value) => { clearTimeout(timer); resolve(value); },
      (error: unknown) => { clearTimeout(timer); reject(error); }
    );
  });

  const lookup: LookupFunction = (_hostname, _options, callback) => {
    callback(null, destination.address, destination.family);
  };

  const result = await new Promise<{ bytes: ArrayBuffer; contentType?: string }>((resolve, reject) => {
    let settled = false;
    let absoluteTimer: ReturnType<typeof setTimeout> | undefined;

    const finish = (value: { bytes: ArrayBuffer; contentType?: string }): void => {
      if (settled) return;
      settled = true;
      if (absoluteTimer) clearTimeout(absoluteTimer);
      resolve(value);
    };
    const fail = (error: Error): void => {
      if (settled) return;
      settled = true;
      if (absoluteTimer) clearTimeout(absoluteTimer);
      reject(error);
    };

    const request = https.request(destination.url, {
      method: "GET",
      lookup,
      headers: {
        Accept: "image/png,image/jpeg,image/gif,image/webp",
        "User-Agent": "ImgReady/0.1.2"
      }
    }, (response) => {
      const status = response.statusCode ?? 0;
      if (status >= 300 && status < 400) {
        response.resume();
        fail(new Error("Redirects are blocked so every contacted host is known before download."));
        return;
      }
      if (status < 200 || status >= 300) {
        response.resume();
        fail(new Error(`Image request failed with HTTP ${status}.`));
        return;
      }

      const length = Number(response.headers["content-length"] ?? 0);
      if (Number.isFinite(length) && length > limits.maxFileBytes) {
        response.resume();
        fail(new Error(`Image exceeds the per-file limit (${limits.maxFileBytes} bytes).`));
        return;
      }

      const chunks: Buffer[] = [];
      let total = 0;
      response.on("data", (chunk: Buffer) => {
        if (settled) return;
        total += chunk.length;
        if (total > limits.maxFileBytes) {
          request.destroy(new Error(`Image exceeds the per-file limit (${limits.maxFileBytes} bytes).`));
          return;
        }
        chunks.push(chunk);
      });
      response.on("aborted", () => fail(new Error("Image response was aborted.")));
      response.on("error", (error: Error) => fail(error instanceof Error ? error : new Error(String(error))));
      response.on("end", () => {
        if (settled) return;
        const buffer = Buffer.concat(chunks);
        const bytes = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
        finish({ bytes, contentType: response.headers["content-type"] });
      });
    });

    request.setTimeout(Math.min(10_000, limits.requestTimeoutMs), () => {
      request.destroy(new Error("Image request became idle and timed out."));
    });
    absoluteTimer = setTimeout(() => {
      request.destroy(new Error("Image request exceeded the absolute timeout."));
    }, limits.requestTimeoutMs);

    request.on("error", (error: Error) => fail(error instanceof Error ? error : new Error(String(error))));
    request.end();
  });

  const validated = validateImagePayload(result.bytes, result.contentType, {
    maxDimension: limits.maxDimension,
    maxPixels: limits.maxPixels
  });

  return {
    sourceUrl: rawUrl,
    host: destination.url.hostname.toLowerCase(),
    bytes: result.bytes,
    type: validated.type,
    mime: validated.mime
  };
}
