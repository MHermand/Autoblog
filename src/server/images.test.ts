import { describe, expect, it } from "vitest";
import { imageObjectPath, sanitizeImageName, sniffImageType } from "./images";

const bytes = (...values: number[]) => new Uint8Array(values);

describe("sniffImageType", () => {
  it("detects formats from magic bytes", () => {
    expect(sniffImageType(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0))).toBe("image/png");
    expect(sniffImageType(bytes(0xff, 0xd8, 0xff, 0xe0))).toBe("image/jpeg");
    expect(sniffImageType(new TextEncoder().encode("GIF89a..."))).toBe("image/gif");
    expect(sniffImageType(new TextEncoder().encode("RIFF\0\0\0\0WEBPVP8 "))).toBe("image/webp");
  });

  it("rejects everything else, including SVG and HTML disguised as images", () => {
    expect(sniffImageType(new TextEncoder().encode("<svg xmlns="))).toBeNull();
    expect(sniffImageType(new TextEncoder().encode("<html><script>"))).toBeNull();
    expect(sniffImageType(new TextEncoder().encode("RIFF\0\0\0\0WAVE"))).toBeNull();
    expect(sniffImageType(bytes())).toBeNull();
  });
});

describe("imageObjectPath", () => {
  it("builds posts/<folder>/<safe name>.<ext>", () => {
    expect(imageObjectPath("abc", "My Photo (1).PNG", "image/png")).toBe("posts/abc/my-photo-1.png");
    expect(imageObjectPath("abc", "cover", "image/jpeg")).toBe("posts/abc/cover.jpg");
  });

  it("neutralizes path traversal and empty names", () => {
    expect(sanitizeImageName("../../etc/passwd")).toBe("etc-passwd");
    expect(sanitizeImageName("???.webp")).toBe("image");
    expect(sanitizeImageName("x".repeat(100)).length).toBe(60);
  });
});
