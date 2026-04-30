import { describe, test, expect, mock } from "bun:test";
import { ImageFilterService } from "../src/image-filter";
import type { ImageFilterConfig } from "../src/types";

// ─── filter-image: ImageFilterService ────────────────────────────────────────
//
// Strategy: mock hanya dua external dependencies:
//   1. Cloudflare AI (`this.ai.run`) — tidak tersedia di test environment
//   2. `fetch` global — untuk isImageAllowed (URL-based)
//
// Yang DIUJI: business logic di _runDetection, content type guards,
//             null URL guards, dan error fallback behavior.
// Anti-pattern dihindari: tidak ada test-only methods, tidak test mock internals.

// ── Config default (NSFW detection) ──────────────────────────────────────────
const CONFIG_NSFW: ImageFilterConfig = {
  blockedLabels: ["person", "nudity"],
  confidenceThreshold: 0.15,
};

// ── Config untuk cover buku ───────────────────────────────────────────────────
const CONFIG_BOOK_COVER: ImageFilterConfig = {
  blockedLabels: ["nudity", "explicit"],
  confidenceThreshold: 0.2,
};

// ── Helper: buat mock AI ──────────────────────────────────────────────────────
function createMockAi(detections: { label: string; score: number }[]) {
  return {
    run: mock(async () => detections),
  } as any;
}

// ─────────────────────────────────────────────────────────────────────────────

describe("ImageFilterService — isImageBufferAllowed", () => {
  // ── TDD 1: Content type guard ──────────────────────────────────────────────
  test("rejects non-image content type before running AI", async () => {
    const ai = createMockAi([]); // AI tidak seharusnya dipanggil
    const service = new ImageFilterService(ai, CONFIG_NSFW);

    const buffer = new ArrayBuffer(10);
    const result = await service.isImageBufferAllowed(buffer, "application/pdf");

    expect(result.allowed).toBe(false);
    expect(result.reason).toBe("File bukan gambar yang valid");
    // Pastikan AI TIDAK dipanggil untuk non-image (anti-pattern: test real behavior)
    expect((ai.run as any).mock.calls.length).toBe(0);
  });

  // ── TDD 2: Valid image passes when no blocked labels detected ──────────────
  test("allows image when AI detects no blocked labels", async () => {
    const ai = createMockAi([
      { label: "cat", score: 0.95 },
      { label: "dog", score: 0.72 },
    ]);
    const service = new ImageFilterService(ai, CONFIG_NSFW);

    const buffer = new ArrayBuffer(100);
    const result = await service.isImageBufferAllowed(buffer, "image/jpeg");

    expect(result.allowed).toBe(true);
    expect(result.reason).toBeUndefined();
  });

  // ── TDD 3: Blocks image when blocked label detected above threshold ─────────
  test("blocks image when blocked label score exceeds threshold", async () => {
    const ai = createMockAi([
      { label: "cat", score: 0.8 },
      { label: "nudity", score: 0.92 }, // > 0.15 threshold
    ]);
    const service = new ImageFilterService(ai, CONFIG_NSFW);

    const buffer = new ArrayBuffer(100);
    const result = await service.isImageBufferAllowed(buffer, "image/png");

    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("nudity");
    expect(result.reason).toContain("92.0%");
  });

  // ── TDD 4: Allows image when blocked label below threshold ─────────────────
  test("allows image when blocked label score is below threshold", async () => {
    const ai = createMockAi([
      { label: "person", score: 0.05 }, // 0.05 < 0.15 threshold → OK
    ]);
    const service = new ImageFilterService(ai, CONFIG_NSFW);

    const buffer = new ArrayBuffer(100);
    const result = await service.isImageBufferAllowed(buffer, "image/webp");

    expect(result.allowed).toBe(true);
  });

  // ── TDD 5: Custom threshold per config ────────────────────────────────────
  test("respects custom confidenceThreshold from config", async () => {
    const ai = createMockAi([
      { label: "nudity", score: 0.18 }, // > 0.15 default tapi < 0.2 custom
    ]);
    const service = new ImageFilterService(ai, CONFIG_BOOK_COVER); // threshold 0.2

    const buffer = new ArrayBuffer(100);
    const result = await service.isImageBufferAllowed(buffer, "image/jpeg");

    // Score 0.18 di bawah threshold 0.2 → diizinkan
    expect(result.allowed).toBe(true);
  });

  test("blocks when score exactly at threshold (strict >)", async () => {
    const ai = createMockAi([
      { label: "nudity", score: 0.20 }, // tepat di threshold 0.2 → harus lolos (score > threshold)
    ]);
    const service = new ImageFilterService(ai, CONFIG_BOOK_COVER);

    const buffer = new ArrayBuffer(100);
    const result = await service.isImageBufferAllowed(buffer, "image/jpeg");

    // score 0.20 TIDAK > 0.20, jadi diizinkan
    expect(result.allowed).toBe(true);
  });

  // ── TDD 6: Empty detections array → allow ─────────────────────────────────
  test("allows image when AI returns empty detection array", async () => {
    const ai = createMockAi([]); // tidak ada deteksi
    const service = new ImageFilterService(ai, CONFIG_NSFW);

    const buffer = new ArrayBuffer(100);
    const result = await service.isImageBufferAllowed(buffer, "image/gif");

    expect(result.allowed).toBe(true);
  });

  // ── TDD 7: AI error fallback — allow by default ────────────────────────────
  test("allows image when AI throws an error (fail-open policy)", async () => {
    const ai = {
      run: mock(async () => {
        throw new Error("AI service unavailable");
      }),
    } as any;
    const service = new ImageFilterService(ai, CONFIG_NSFW);

    const buffer = new ArrayBuffer(100);
    const result = await service.isImageBufferAllowed(buffer, "image/jpeg");

    // Fail-open: AI error → allow image (don't block users)
    expect(result.allowed).toBe(true);
  });

  // ── TDD 8: AI 429 quota exceeded → allow ──────────────────────────────────
  test("allows image when AI returns 429 quota exceeded error", async () => {
    const ai = {
      run: mock(async () => {
        const err = new Error("Rate limit exceeded 429");
        (err as any).message = "429 Too Many Requests";
        throw err;
      }),
    } as any;
    const service = new ImageFilterService(ai, CONFIG_NSFW);

    const buffer = new ArrayBuffer(100);
    const result = await service.isImageBufferAllowed(buffer, "image/jpeg");

    expect(result.allowed).toBe(true);
  });

  // ── TDD 9: First blocked label stops evaluation ────────────────────────────
  test("returns reason for first blocked label that exceeds threshold", async () => {
    const ai = createMockAi([
      { label: "nudity", score: 0.85 },
      { label: "person", score: 0.95 }, // kedua blocked label
    ]);
    const service = new ImageFilterService(ai, CONFIG_NSFW);

    const buffer = new ArrayBuffer(100);
    const result = await service.isImageBufferAllowed(buffer, "image/jpeg");

    expect(result.allowed).toBe(false);
    // Reason harus untuk label pertama yang ditemukan
    expect(result.reason).toContain("nudity");
  });

  // ── TDD 10: Non-blocked labels ignored ────────────────────────────────────
  test("ignores high-score detections for non-blocked labels", async () => {
    const ai = createMockAi([
      { label: "car", score: 0.99 },
      { label: "building", score: 0.87 },
      { label: "tree", score: 0.75 },
    ]);
    const service = new ImageFilterService(ai, CONFIG_NSFW);

    const buffer = new ArrayBuffer(100);
    const result = await service.isImageBufferAllowed(buffer, "image/jpeg");

    expect(result.allowed).toBe(true);
  });
});

describe("ImageFilterService — isImageAllowed (URL-based)", () => {
  // ── TDD 11: Rejects non-image URL response ─────────────────────────────────
  test("rejects when URL content-type is not image", async () => {
    const mockFetch = mock(async () =>
      new Response("<html>Not an image</html>", {
        status: 200,
        headers: { "Content-Type": "text/html" },
      })
    );
    globalThis.fetch = mockFetch as any;

    const ai = createMockAi([]);
    const service = new ImageFilterService(ai, CONFIG_NSFW);

    const result = await service.isImageAllowed("https://example.com/page.html");

    expect(result.allowed).toBe(false);
    expect(result.reason).toBe("URL bukan gambar yang valid");
  });

  // ── TDD 12: Rejects when fetch fails (non-ok status) ──────────────────────
  test("rejects when URL fetch returns non-ok status", async () => {
    const mockFetch = mock(async () =>
      new Response("Not Found", { status: 404 })
    );
    globalThis.fetch = mockFetch as any;

    const ai = createMockAi([]);
    const service = new ImageFilterService(ai, CONFIG_NSFW);

    const result = await service.isImageAllowed("https://example.com/missing.jpg");

    expect(result.allowed).toBe(false);
    expect(result.reason).toBe("Gagal mengambil gambar dari URL");
  });

  // ── TDD 13: Fetch error → fail-open (allow) ───────────────────────────────
  test("allows image when fetch throws a network error (fail-open)", async () => {
    globalThis.fetch = mock(async () => {
      throw new Error("Network error");
    }) as any;

    const ai = createMockAi([]);
    const service = new ImageFilterService(ai, CONFIG_NSFW);

    const result = await service.isImageAllowed("https://example.com/image.jpg");

    // Fail-open: network error → allow
    expect(result.allowed).toBe(true);
  });
});

describe("ImageFilterService — filterImageUrl", () => {
  // ── TDD 14: Null/undefined URL returns null ────────────────────────────────
  test("returns null for null URL without calling AI", async () => {
    const ai = createMockAi([]);
    const service = new ImageFilterService(ai, CONFIG_NSFW);

    const result = await service.filterImageUrl(null);
    expect(result).toBeNull();
    expect((ai.run as any).mock.calls.length).toBe(0);
  });

  test("returns null for undefined URL without calling AI", async () => {
    const ai = createMockAi([]);
    const service = new ImageFilterService(ai, CONFIG_NSFW);

    const result = await service.filterImageUrl(undefined);
    expect(result).toBeNull();
    expect((ai.run as any).mock.calls.length).toBe(0);
  });

  // ── TDD 15: Returns URL when image passes filter ───────────────────────────
  test("returns original URL when image is allowed", async () => {
    const mockFetch = mock(async () =>
      new Response(new ArrayBuffer(10), {
        status: 200,
        headers: { "Content-Type": "image/jpeg" },
      })
    );
    globalThis.fetch = mockFetch as any;

    const ai = createMockAi([{ label: "cat", score: 0.9 }]); // cat is not blocked
    const service = new ImageFilterService(ai, CONFIG_NSFW);

    const url = "https://example.com/cat.jpg";
    const result = await service.filterImageUrl(url);

    expect(result).toBe(url);
  });

  // ── TDD 16: Returns null when image is blocked ─────────────────────────────
  test("returns null when image is blocked", async () => {
    const mockFetch = mock(async () =>
      new Response(new ArrayBuffer(10), {
        status: 200,
        headers: { "Content-Type": "image/jpeg" },
      })
    );
    globalThis.fetch = mockFetch as any;

    const ai = createMockAi([{ label: "nudity", score: 0.95 }]);
    const service = new ImageFilterService(ai, CONFIG_NSFW);

    const result = await service.filterImageUrl("https://example.com/bad.jpg");

    expect(result).toBeNull();
  });
});

describe("ImageFilterService — config defaults", () => {
  // ── TDD 17: Default threshold = 0.15 when not specified ───────────────────
  test("uses 0.15 as default threshold when not specified in config", async () => {
    const configWithoutThreshold: ImageFilterConfig = {
      blockedLabels: ["nudity"],
      // confidenceThreshold omitted → defaults to 0.15
    };

    // Score 0.14 < 0.15 → should be allowed
    const aiAllow = createMockAi([{ label: "nudity", score: 0.14 }]);
    const serviceAllow = new ImageFilterService(aiAllow, configWithoutThreshold);
    const resultAllow = await serviceAllow.isImageBufferAllowed(
      new ArrayBuffer(10),
      "image/jpeg",
    );
    expect(resultAllow.allowed).toBe(true);

    // Score 0.16 > 0.15 → should be blocked
    const aiBlock = createMockAi([{ label: "nudity", score: 0.16 }]);
    const serviceBlock = new ImageFilterService(aiBlock, configWithoutThreshold);
    const resultBlock = await serviceBlock.isImageBufferAllowed(
      new ArrayBuffer(10),
      "image/jpeg",
    );
    expect(resultBlock.allowed).toBe(false);
  });
});
