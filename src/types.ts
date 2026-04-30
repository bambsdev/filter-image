export interface ImageFilterConfig {
  blockedLabels: string[];
  confidenceThreshold?: number;
}

export interface IImageFilterService {
  isImageBufferAllowed(
    buffer: ArrayBuffer,
    contentType: string,
  ): Promise<{ allowed: boolean; reason?: string }>;
  isImageAllowed(
    imageUrl: string,
  ): Promise<{ allowed: boolean; reason?: string }>;
  filterImageUrl(imageUrl: string | null | undefined): Promise<string | null>;
}
