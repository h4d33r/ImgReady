import { describe, expect, it } from "vitest";
import { encodeVaultLinkTarget, validateAttachmentRoot } from "../src/attachmentManager";
import { detectImageType, getImageDimensions, validateImagePayload } from "../src/fileValidation";
import { replaceRemoteUrls, scanImages } from "../src/imageScanner";
import { isBlockedAddress, normalizeTrustedHosts, validateUrlShape } from "../src/security";
import { DEFAULT_SETTINGS, sanitizeSettings } from "../src/settings";

function png(width = 1, height = 1): Uint8Array {
  const bytes = new Uint8Array(24);
  bytes.set([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a], 0);
  bytes.set([0x49,0x48,0x44,0x52], 12);
  bytes[16]=(width>>>24)&255; bytes[17]=(width>>>16)&255; bytes[18]=(width>>>8)&255; bytes[19]=width&255;
  bytes[20]=(height>>>24)&255; bytes[21]=(height>>>16)&255; bytes[22]=(height>>>8)&255; bytes[23]=height&255;
  return bytes;
}
const ab = (b: Uint8Array): ArrayBuffer => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);

describe("scanner", () => {
  it("finds local/remote images and hosts", () => {
    const scan = scanImages('![r](https://cdn.example.com/a.png)\n![[local.png]]\n<img src="pic.jpg">');
    expect(scan.remote).toHaveLength(1);
    expect(scan.local).toHaveLength(2);
    expect(scan.hosts).toEqual(["cdn.example.com"]);
  });
  it("ignores code and comments", () => {
    expect(scanImages('`![x](https://bad.example/a.png)`\n<!-- ![y](https://bad.example/b.png) -->').remote).toHaveLength(0);
  });
  it("handles URL parentheses", () => {
    expect(scanImages('![x](https://cdn.example.com/image_(1).png)').remote[0]?.url)
      .toBe("https://cdn.example.com/image_(1).png");
  });
  it("replaces only matching URLs", () => {
    expect(replaceRemoteUrls('![x](https://a.example/x.png)', new Map([["https://a.example/x.png","Attachments/x.png"]])))
      .toBe("![x](Attachments/x.png)");
  });
});

describe("payload validation", () => {
  it("detects PNG and dimensions", () => {
    const p = png(800, 600);
    expect(detectImageType(p)).toBe("png");
    expect(getImageDimensions(p, "png")).toEqual({width:800,height:600});
    expect(validateImagePayload(ab(p), "image/png").type).toBe("png");
  });
  it("rejects MIME mismatch and SVG", () => {
    expect(() => validateImagePayload(ab(png()), "image/jpeg")).toThrow();
    expect(() => validateImagePayload(ab(new TextEncoder().encode("<svg></svg>")), "image/svg+xml")).toThrow();
  });
  it("enforces dimension and pixel limits", () => {
    expect(() => validateImagePayload(ab(png(2000,10)), "image/png", {maxDimension:1000,maxPixels:10_000_000})).toThrow();
    expect(() => validateImagePayload(ab(png(1000,1000)), "image/png", {maxDimension:2000,maxPixels:500_000})).toThrow();
  });
});

describe("URL security", () => {
  const policy = {trustedHosts:["cdn.example.com"],allowNonStandardHttpsPorts:false};

  it("normalizes exact host trust", () => {
    expect(normalizeTrustedHosts([" CDN.Example.com. ","cdn.example.com"])).toEqual(["cdn.example.com"]);
  });
  it.each(["127.0.0.1","192.168.1.1","169.254.169.254","100.64.0.1","::1","fd00::1","fe80::1","::ffff:127.0.0.1"])(
    "blocks non-public address %s", (ip) => expect(isBlockedAddress(ip)).toBe(true)
  );
  it("allows public addresses", () => {
    expect(isBlockedAddress("8.8.8.8")).toBe(false);
    expect(isBlockedAddress("2606:4700:4700::1111")).toBe(false);
  });
  it("requires HTTPS, exact trust and default port", () => {
    expect(() => validateUrlShape("http://cdn.example.com/a.png",policy)).toThrow();
    expect(() => validateUrlShape("https://other.example/a.png",policy)).toThrow();
    expect(() => validateUrlShape("https://cdn.example.com:8443/a.png",policy)).toThrow();
  });
  it("rejects local/internal and credentials", () => {
    expect(() => validateUrlShape("https://localhost/a.png",{...policy,trustedHosts:["localhost"]})).toThrow();
    expect(() => validateUrlShape("https://svc.internal/a.png",{...policy,trustedHosts:["svc.internal"]})).toThrow();
    expect(() => validateUrlShape("https://user:pass@cdn.example.com/a.png",policy)).toThrow();
  });
  it("blocks decimal loopback notation after URL normalization", () => {
    expect(() => validateUrlShape("https://2130706433/a.png",{...policy,trustedHosts:["127.0.0.1"]})).toThrow();
  });
});

describe("attachment paths/settings", () => {
  it("rejects traversal, hidden and Windows-reserved paths", () => {
    expect(() => validateAttachmentRoot("../bad")).toThrow();
    expect(() => validateAttachmentRoot(".obsidian/plugins")).toThrow();
    expect(() => validateAttachmentRoot("Attachments/CON")).toThrow();
  });
  it("encodes Markdown-sensitive link characters", () => {
    expect(encodeVaultLinkTarget("Attachments/O'Brien/image_(1)#x?.png"))
      .toBe("Attachments/O%27Brien/image_%281%29%23x%3F.png");
  });
  it("sanitizes persisted settings", () => {
    expect(sanitizeSettings(null)).toEqual(DEFAULT_SETTINGS);
    expect(sanitizeSettings({attachmentRoot:"../bad"}).attachmentRoot).toBe("Attachments");
    expect(sanitizeSettings({allowNonStandardHttpsPorts:"true" as unknown as boolean}).allowNonStandardHttpsPorts).toBe(false);
  });
});
