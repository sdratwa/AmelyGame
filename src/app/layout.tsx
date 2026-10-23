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
  // iPhone: po "Dodaj do ekranu początkowego" gra działa bez paska Safari.
  appleWebApp: { capable: true, title: "Miasto", statusBarStyle: "black-translucent" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  // Bez `cover` iOS zostawia puste pasy przy notchu, a `env(safe-area-inset-*)` zawsze wynosi 0.
  viewportFit: "cover",
  themeColor: "#0b1220",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="pl"
      className={`${geistSans.variable} dark h-full antialiased`}
      // Rozszerzenia/przeglądarka (np. atrybut __gcrremoteframetoken) dopisują atrybuty
      // do <html> przed hydracją; to nie jest błąd aplikacji.
      suppressHydrationWarning
    >
      <body className="h-dvh overflow-hidden bg-slate-950 text-slate-50">
        {children}
      </body>
    </html>
  );
}
