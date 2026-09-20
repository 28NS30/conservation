import type { Metadata } from "next";
import "./globals.css";

const SITE = "https://biowatchintl.org";

export const metadata: Metadata = {
  metadataBase: new URL(SITE),
  title: {
    default: "BioWatch International",
    template: "%s · BioWatch International",
  },
  description:
    "Open environmental monitoring, built with the people who live there. Citizen reports, open identification, public maps — currently in Taiwan, with a partner project in Colombia.",
  openGraph: {
    type: "website",
    siteName: "BioWatch International",
    url: SITE,
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="h-full">
      <body className="min-h-full antialiased">{children}</body>
    </html>
  );
}
