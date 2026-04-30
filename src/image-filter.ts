import type { ImageFilterConfig, IImageFilterService } from "./types";

export class ImageFilterService implements IImageFilterService {
  private readonly threshold: number;

  constructor(
    private readonly ai: Ai,
    private readonly config: ImageFilterConfig,
  ) {
    this.threshold = config.confidenceThreshold ?? 0.15;
  }

  async isImageAllowed(
    imageUrl: string,
  ): Promise<{ allowed: boolean; reason?: string }> {
    try {
      const response = await fetch(imageUrl);
      if (!response.ok) {
        return { allowed: false, reason: "Gagal mengambil gambar dari URL" };
      }

      const contentType = response.headers.get("content-type") ?? "";
      if (!contentType.startsWith("image/")) {
        return { allowed: false, reason: "URL bukan gambar yang valid" };
      }

      const imageBuffer = await response.arrayBuffer();
      return this._runDetection(new Uint8Array(imageBuffer));
    } catch (err: any) {
      console.error("[filter-image] Error:", err?.message ?? err);
      return { allowed: true };
    }
  }

  async isImageBufferAllowed(
    buffer: ArrayBuffer,
    contentType: string,
  ): Promise<{ allowed: boolean; reason?: string }> {
    try {
      if (!contentType.startsWith("image/")) {
        return { allowed: false, reason: "File bukan gambar yang valid" };
      }
      return this._runDetection(new Uint8Array(buffer));
    } catch (err: any) {
      console.error("[filter-image] Buffer filter error:", err?.message ?? err);
      return { allowed: true };
    }
  }

  async filterImageUrl(
    imageUrl: string | null | undefined,
  ): Promise<string | null> {
    if (!imageUrl) return null;
    const result = await this.isImageAllowed(imageUrl);
    if (!result.allowed) {
      console.log(`[filter-image] Image blocked: ${result.reason}`);
      return null;
    }
    return imageUrl;
  }

  private async _runDetection(
    imageArray: Uint8Array,
  ): Promise<{ allowed: boolean; reason?: string }> {
    try {
      const detections = (await this.ai.run(
        "@cf/facebook/detr-resnet-50" as any,
        { image: Array.from(imageArray) },
      )) as unknown as { label: string; score: number }[];

      if (detections && Array.isArray(detections)) {
        console.log(
          "[filter-image] Detection:",
          detections
            .slice(0, 3)
            .map((d) => `${d.label} (${(d.score * 100).toFixed(1)}%)`)
            .join(", "),
        );

        for (const det of detections) {
          if (
            this.config.blockedLabels.includes(det.label) &&
            det.score > this.threshold
          ) {
            return {
              allowed: false,
              reason: `Terdeteksi ${det.label} dengan skor ${(det.score * 100).toFixed(1)}%`,
            };
          }
        }
      }
    } catch (detErr: any) {
      if (detErr?.message?.includes("429") || detErr?.status === 429) {
        console.warn("[filter-image] Quota exceeded (429), allowing image.");
        return { allowed: true };
      }
      console.warn("[filter-image] Detection failed:", detErr?.message ?? detErr);
    }

    return { allowed: true };
  }
}
