import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { pwaManifest } from "../../pwaManifest";

const publicRoot = path.resolve(process.cwd(), "public");
const appRoot = path.resolve(process.cwd());

async function readPngDimensions(filePath: string): Promise<{ width: number; height: number }> {
  const file = await readFile(filePath);
  expect(file.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  expect(file.subarray(12, 16).toString("ascii")).toBe("IHDR");
  return { width: file.readUInt32BE(16), height: file.readUInt32BE(20) };
}

describe("recursos técnicos PWA", () => {
  it("referencia iconos PNG existentes con tamaño y purpose válidos", async () => {
    expect(pwaManifest.theme_color).toBe("#0075DE");
    expect(pwaManifest.background_color).toBe("#FFFFFF");

    for (const icon of pwaManifest.icons) {
      const expectedSize = Number(icon.sizes.split("x")[0]);
      expect(["any", "maskable"]).toContain(icon.purpose);
      expect(icon.type).toBe("image/png");
      await expect(readPngDimensions(path.join(publicRoot, icon.src))).resolves.toEqual({
        width: expectedSize,
        height: expectedSize,
      });
    }
    expect(pwaManifest.icons).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ src: "/icons/pwa-192.png", sizes: "192x192", purpose: "any" }),
        expect.objectContaining({ src: "/icons/pwa-512.png", sizes: "512x512", purpose: "any" }),
        expect.objectContaining({
          src: "/icons/pwa-maskable-512.png",
          sizes: "512x512",
          purpose: "maskable",
        }),
      ]),
    );
  });

  it("incluye favicon SVG y apple-touch-icon válidos", async () => {
    const favicon = await readFile(path.join(publicRoot, "icons/vicam-mark.svg"), "utf8");
    expect(favicon).toContain('fill="#0075DE"');
    expect(favicon).not.toMatch(/<(image|foreignObject)\b/i);
    await expect(
      readPngDimensions(path.join(publicRoot, "icons/apple-touch-icon.png")),
    ).resolves.toEqual({ width: 180, height: 180 });
    const index = await readFile(path.join(appRoot, "index.html"), "utf8");
    expect(index).toContain('rel="icon" href="/icons/vicam-mark.svg"');
    expect(index).toContain('rel="apple-touch-icon" href="/icons/apple-touch-icon.png"');
  });

  it("define un manifest instalable dentro del alcance de la aplicación", () => {
    expect(pwaManifest).toMatchObject({
      name: "VICAM",
      short_name: "VICAM",
      lang: "es-EC",
      start_url: "/app",
      scope: "/",
      display: "standalone",
    });
  });
});
