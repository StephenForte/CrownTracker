import "./globals.css";
import type { Metadata } from "next";
import { ServiceWorkerRegistration } from "@/components/ServiceWorkerRegistration";

export const metadata: Metadata = {
  title: "Crown Tracker",
  description: "Personal Rolex market tracker",
  applicationName: "Crown Tracker",
  appleWebApp: { capable: true, title: "Crown Tracker", statusBarStyle: "default" },
  formatDetection: { telephone: false },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}<ServiceWorkerRegistration /></body></html>;
}
