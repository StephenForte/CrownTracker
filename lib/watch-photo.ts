export const MAX_WATCH_PHOTO_BYTES = 5 * 1024 * 1024;
export const WATCH_PHOTO_TYPES = new Set(["image/avif", "image/gif", "image/jpeg", "image/png", "image/webp"]);

export function watchPhotoError(photo: { size: number; type: string }) {
  if (!WATCH_PHOTO_TYPES.has(photo.type)) return "Choose an AVIF, JPEG, PNG, WebP, or GIF image.";
  if (photo.size === 0) return "Choose an image file with content.";
  if (photo.size > MAX_WATCH_PHOTO_BYTES) return "Choose an image smaller than 5 MB.";
  return null;
}
