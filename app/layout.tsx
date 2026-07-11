import "./globals.css";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Crown Tracker", description: "Personal Rolex market tracker" };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
