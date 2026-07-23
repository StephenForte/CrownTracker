import assert from "node:assert/strict";
import test from "node:test";
import { MAX_WATCH_PHOTO_BYTES, watchPhotoError } from "@/lib/watch-photo";

test("watch photos allow AVIF and other supported image types within the size limit", () => {
  assert.equal(watchPhotoError({ type: "image/avif", size: 1 }), null);
  assert.equal(watchPhotoError({ type: "image/png", size: MAX_WATCH_PHOTO_BYTES }), null);
});

test("watch photos reject unsupported, empty, and oversized uploads", () => {
  assert.match(watchPhotoError({ type: "image/svg+xml", size: 1 }) ?? "", /Choose an AVIF/);
  assert.match(watchPhotoError({ type: "image/jpeg", size: 0 }) ?? "", /content/);
  assert.match(watchPhotoError({ type: "image/jpeg", size: MAX_WATCH_PHOTO_BYTES + 1 }) ?? "", /5 MB/);
});
