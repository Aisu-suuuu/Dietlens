/**
 * Client-side image compression utility
 *
 * Compresses image files to target dimensions and size using Canvas API.
 * Handles aspect ratio preservation, HEIC rejection, and fallback sizing.
 *
 * No external dependencies — pure browser APIs.
 */

export interface CompressResult {
  blob: Blob;
  width: number;
  height: number;
  sizeKB: number;
}

interface CompressOptions {
  maxDimension?: number;
  targetKB?: number;
  mimeType?: "image/jpeg" | "image/webp";
}

/**
 * Compresses an image file to target dimensions and size.
 *
 * Algorithm:
 * 1. Load file into HTMLImageElement via URL.createObjectURL
 * 2. Compute target dimensions preserving aspect ratio (longer edge ≤ maxDimension)
 * 3. Draw to canvas at target dimensions
 * 4. Export via canvas.toBlob with quality starting at 0.82
 * 5. If blob > targetKB * 1.15, decrease quality by 0.08 (floor: 0.55)
 * 6. If still oversized after quality floor, reduce maxDimension by 20% and retry
 * 7. Return result (even if slightly over target)
 *
 * Error handling:
 * - HEIC/HEIF files: early rejection with clear message
 * - toBlob failures: treated as hard error
 * - Orientation: iPhone post-iOS 13 auto-corrects in DOM — no EXIF parsing needed
 *
 * @param file File or Blob to compress
 * @param opts Optional configuration
 * @returns CompressResult with compressed blob and metadata
 * @throws Error if file is HEIC/HEIF or compression fails
 */
export async function compressImage(
  file: File | Blob,
  opts?: CompressOptions
): Promise<CompressResult> {
  const maxDimension = opts?.maxDimension ?? 1600;
  const targetKB = opts?.targetKB ?? 300;
  const mimeType = opts?.mimeType ?? "image/jpeg";

  // Check for HEIC/HEIF files
  if (file.type && (file.type.includes("heic") || file.type.includes("heif"))) {
    throw new Error(
      "HEIC not supported — please set iPhone camera to 'Most Compatible'"
    );
  }

  // Load image from file
  const url = URL.createObjectURL(file);
  let blob: Blob | null = null;
  let width = 0;
  let height = 0;

  try {
    const img = await loadImage(url);
    width = img.naturalWidth;
    height = img.naturalHeight;

    // Compute target dimensions preserving aspect ratio
    let dims = calculateDimensions(width, height, maxDimension);
    let targetWidth = dims.targetWidth;
    let targetHeight = dims.targetHeight;

    // Attempt compression with quality optimization
    blob = await compressWithQuality(
      img,
      targetWidth,
      targetHeight,
      targetKB,
      mimeType
    );

    if (!blob) {
      throw new Error("Failed to create blob from canvas");
    }

    // If still oversized after quality floor, reduce maxDimension by 20%
    if (blob.size > targetKB * 1024 * 1.15) {
      const reducedDimension = Math.floor(maxDimension * 0.8);
      const retryDims = calculateDimensions(width, height, reducedDimension);

      const retryBlob = await compressWithQuality(
        img,
        retryDims.targetWidth,
        retryDims.targetHeight,
        targetKB,
        mimeType
      );

      if (retryBlob) {
        blob = retryBlob;
        targetWidth = retryDims.targetWidth;
        targetHeight = retryDims.targetHeight;
      }
    }

    const sizeKB = Math.round(blob.size / 1024);

    return {
      blob,
      width: targetWidth,
      height: targetHeight,
      sizeKB,
    };
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * Load an image from an object URL
 */
function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Failed to load image"));
    img.crossOrigin = "anonymous";
    img.src = url;
  });
}

/**
 * Calculate target dimensions preserving aspect ratio
 */
function calculateDimensions(
  originalWidth: number,
  originalHeight: number,
  maxDimension: number
): { targetWidth: number; targetHeight: number } {
  const isLandscape = originalWidth >= originalHeight;
  const longerEdge = isLandscape ? originalWidth : originalHeight;

  if (longerEdge <= maxDimension) {
    return { targetWidth: originalWidth, targetHeight: originalHeight };
  }

  const scale = maxDimension / longerEdge;
  return {
    targetWidth: Math.round(originalWidth * scale),
    targetHeight: Math.round(originalHeight * scale),
  };
}

/**
 * Compress image with quality optimization
 * Decreases quality iteratively until blob size is acceptable
 */
async function compressWithQuality(
  img: HTMLImageElement,
  targetWidth: number,
  targetHeight: number,
  targetKB: number,
  mimeType: string
): Promise<Blob | null> {
  const canvas = document.createElement("canvas");
  canvas.width = targetWidth;
  canvas.height = targetHeight;

  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error("Failed to get canvas context");
  }

  ctx.drawImage(img, 0, 0, targetWidth, targetHeight);

  // Start with quality 0.82
  let quality = 0.82;
  const targetBytes = targetKB * 1024;
  const qualityFloor = 0.55;

  while (quality >= qualityFloor) {
    const blob = await canvasToBlob(canvas, mimeType, quality);

    if (!blob) {
      quality -= 0.08;
      continue;
    }

    // Accept if within 115% of target
    if (blob.size <= targetBytes * 1.15) {
      return blob;
    }

    quality -= 0.08;
  }

  // Fallback: return at quality floor even if oversized
  return canvasToBlob(canvas, mimeType, qualityFloor);
}

/**
 * Convert canvas to blob with proper promise handling
 */
function canvasToBlob(
  canvas: HTMLCanvasElement,
  mimeType: string,
  quality: number
): Promise<Blob | null> {
  return new Promise((resolve) => {
    canvas.toBlob((blob) => resolve(blob), mimeType, quality);
  });
}
