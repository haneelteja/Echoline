import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

// One modern sans-serif across the whole app (headings included) per the
// design system in use — a dev-tool-documentation look, not a display/body
// typeface pairing.
const inter = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" });

export const metadata: Metadata = {
  title: "Echoline — email & WhatsApp outreach",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={inter.variable}>
      <body>{children}</body>
    </html>
  );
}
