import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Crown Tracker",
    short_name: "Crown Tracker",
    description: "Personal Rolex market tracker",
    start_url: "/",
    display: "standalone",
    background_color: "#fafaf7",
    theme_color: "#113d31",
    icons: [
      { src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
      { src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "maskable" },
    ],
  };
}
