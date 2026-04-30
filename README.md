# @bambsdev/filter-image

A modular image filtering service for Cloudflare Workers that uses Cloudflare Workers AI to detect and block inappropriate or unwanted image content. Designed as a decoupled package to be integrated with authentication and application services.

## Features

- **Object Detection**: Uses `@cf/facebook/detr-resnet-50` model via Cloudflare Workers AI
- **Configurable Blocklists**: Define custom blocked labels and confidence thresholds per use case
- **Multiple Input Methods**: Filter image buffers, URLs, or base64-encoded images
- **Type-Safe**: Full TypeScript support with strict types
- **Zero Dependencies**: No external runtime dependencies beyond Cloudflare Workers AI
- **Production Ready**: Built and tested for Cloudflare Workers environment

## Installation

```bash
npm install @bambsdev/filter-image
# or
bun add @bambsdev/filter-image
```

## Quick Start

```typescript
import { ImageFilterService } from "@bambsdev/filter-image";

// Define a filter configuration
const filterConfig = {
  blockedLabels: ["person", "dog", "cat"],
  confidenceThreshold: 0.20,
};

// Create service instance with Cloudflare AI binding
const imageFilter = new ImageFilterService(env.AI, filterConfig);

// Filter an image buffer
const buffer = await file.arrayBuffer();
const result = await imageFilter.isImageBufferAllowed(buffer, file.type);

if (!result.allowed) {
  console.error(`Image rejected: ${result.reason}`);
}
```

## API Reference

### `ImageFilterService`

Main service class for image filtering operations.

#### Constructor

```typescript
constructor(ai: Ai, config: ImageFilterConfig)
```

- `ai`: Cloudflare Workers AI binding
- `config`: Configuration object with blocked labels and threshold

#### Methods

##### `isImageBufferAllowed(buffer: ArrayBuffer, mimeType: string): Promise<FilterResult>`

Check if an image buffer is allowed based on filter configuration.

**Parameters:**
- `buffer`: ArrayBuffer of the image file
- `mimeType`: MIME type (e.g., "image/jpeg", "image/png")

**Returns:** `{ allowed: boolean; reason?: string }`

**Example:**
```typescript
const result = await imageFilter.isImageBufferAllowed(
  await file.arrayBuffer(),
  file.type
);
```

##### `isImageAllowed(base64Image: string, mimeType: string): Promise<FilterResult>`

Check if a base64-encoded image is allowed.

**Parameters:**
- `base64Image`: Base64-encoded image string (without data URL prefix)
- `mimeType`: MIME type

**Returns:** `{ allowed: boolean; reason?: string }`

##### `filterImageUrl(imageUrl: string): Promise<string | null>`

Filter an image by URL. Returns the URL if allowed, null if blocked.

**Parameters:**
- `imageUrl`: Full URL to the image

**Returns:** Image URL if allowed, `null` if blocked

**Example:**
```typescript
const filteredUrl = await imageFilter.filterImageUrl(googleUser.picture);
// Returns the picture URL or null
```

## Configuration Examples

### User Avatar (Strictest)

```typescript
export const IMAGE_FILTER_USER_AVATAR = {
  blockedLabels: [
    "person",
    "dog",
    "cat",
    "bird",
    "horse",
    "bicycle",
    "motorcycle",
    "car",
    "truck",
    "airplane",
    "weapon",
  ],
  confidenceThreshold: 0.15,
};
```

### Store Avatar (Moderate)

```typescript
export const IMAGE_FILTER_STORE_AVATAR = {
  blockedLabels: [
    "person",
    "dog",
    "cat",
    "bird",
    "horse",
    "weapon",
    "firearm",
  ],
  confidenceThreshold: 0.20,
};
```

### Book Cover (Lenient)

```typescript
export const IMAGE_FILTER_BOOK_COVER = {
  blockedLabels: ["bikini", "brassiere", "miniskirt", "gun", "weapon"],
  confidenceThreshold: 0.30,
};
```

### Images & Banners (Lenient)

```typescript
export const IMAGE_FILTER_LENIENT = {
  blockedLabels: ["bikini", "brassiere", "miniskirt", "gun", "weapon"],
  confidenceThreshold: 0.30,
};
```

## Configuration Interface

```typescript
export interface ImageFilterConfig {
  // List of object labels to block
  // Labels come from DETR model output (e.g., "person", "dog", "bikini")
  blockedLabels: string[];

  // Confidence threshold (0.0 to 1.0)
  // Objects detected with confidence >= threshold are checked against blockedLabels
  confidenceThreshold: number;
}
```

## Error Handling

The service returns structured results instead of throwing errors:

```typescript
const result = await imageFilter.isImageBufferAllowed(buffer, "image/jpeg");

if (!result.allowed) {
  // result.reason contains a human-readable error message
  // Reasons may include:
  // - "Image contains blocked object: <label> (confidence: <score>)"
  // - "Failed to process image" (on AI service errors)
  console.error(result.reason);
}
```

## Cloudflare Bindings

Requires the `AI` binding in your Cloudflare Worker environment:

```typescript
interface Bindings {
  AI: Ai; // Cloudflare Workers AI
}
```

Configure in `wrangler.toml`:

```toml
[[ai]]
binding = "AI"
```

## Design Principles

- **Separation of Concerns**: Image filtering logic is decoupled from auth/app logic
- **Configurability**: Each use case (avatar, cover, banner) can define its own rules
- **Fail-Safe**: If AI detection fails, the image is allowed (graceful degradation)
- **Type Safety**: Full TypeScript types for all interfaces and methods
- **Performance**: Minimal overhead; detection is the only async operation

## Use in Hono Applications

```typescript
import { OpenAPIHono } from "@hono/zod-openapi";
import { ImageFilterService } from "@bambsdev/filter-image";
import { IMAGE_FILTER_STORE_AVATAR } from "./config/image-filter.config";

const app = new OpenAPIHono({ Bindings });

app.post("/upload-avatar", async (c) => {
  const file = (await c.req.formData()).get("file") as File;
  const imageFilter = new ImageFilterService(
    c.env.AI,
    IMAGE_FILTER_STORE_AVATAR
  );

  const buffer = await file.arrayBuffer();
  const result = await imageFilter.isImageBufferAllowed(buffer, file.type);

  if (!result.allowed) {
    return c.json({ error: result.reason }, 400);
  }

  // Proceed with upload
  return c.json({ success: true });
});
```

## Versioning

- **v1.0.0**: Initial release with configurable filter config
- **Semantic Versioning**: Breaking changes increment major version

## License

MIT
