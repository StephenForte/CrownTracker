import { z } from "zod";

export const trackedWatchUrlSchema = z.string().trim().min(1).max(2000).url().refine((value) => {
  try {
    const protocol = new URL(value).protocol;
    return protocol === "http:" || protocol === "https:";
  } catch {
    return false;
  }
}, "Tracked watch URL must start with http:// or https://.");

export const nullableTrackedWatchUrlSchema = z.preprocess(
  (value) => typeof value === "string" && value.trim() === "" ? null : value,
  trackedWatchUrlSchema.nullable(),
);
