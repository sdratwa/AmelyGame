import type { Metadata, Viewport } from "next";
import { Geist } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin", "latin-ext"],
});

export const metadata: Metadata = {
  title: "Gra Miasto",
  description:
    "Przygodowa gra przeglądarkowa: eksploruj miasto, przetrwaj zimę i znajdź swój dom.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#0b1220",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="pl" className={`${geistSans.variable} dark h-full antialiased`}>
      <body className="h-dvh overflow-hidden bg-slate-950 text-slate-50">
        {children}
      </body>
    </html>
  );
}
