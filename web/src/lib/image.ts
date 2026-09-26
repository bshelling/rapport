import { gps } from "exifr";

export const MAX_DIMENSION = 2048;

export type PreparedPhoto = {
  blob: Blob;
  previewUrl: string;
  gps: { lat: number; lng: number } | null;
};

/**
 * Read the photo's GPS position (to prefill the location), then re-encode it
 * through a canvas. Re-encoding drops all EXIF metadata, so location and
 * device details never leave the browser, and keeps uploads small.
 */
export async function preparePhoto(file: File): Promise<PreparedPhoto> {
  const position = await gps(file).catch(() => null);
  const bitmap = await createImageBitmap(file, {
    imageOrientation: "from-image",
  });
  const { width, height } = fitWithin(
    bitmap.width,
    bitmap.height,
    MAX_DIMENSION,
  );
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("canvas unavailable");
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();
  const blob = await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error("encode failed"))),
      "image/jpeg",
      0.85,
    ),
  );
  return {
    blob,
    previewUrl: URL.createObjectURL(blob),
    gps:
      position &&
      Number.isFinite(position.latitude) &&
      Number.isFinite(position.longitude)
        ? { lat: position.latitude, lng: position.longitude }
        : null,
  };
}

export function fitWithin(
  w: number,
  h: number,
  max: number,
): { width: number; height: number } {
  const scale = Math.min(1, max / Math.max(w, h));
  return { width: Math.round(w * scale), height: Math.round(h * scale) };
}
