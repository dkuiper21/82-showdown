import "./globals.css";
import { Analytics } from "@vercel/analytics/next";

const SITE_URL = "https://82-showdown.com";
const TITLE = "82 Showdown — Head-to-Head NBA Draft";
const DESCRIPTION =
  "Draft an 8-man rotation from random NBA seasons and battle a friend in a best-of-7 series.";

export const metadata = {
  metadataBase: new URL(SITE_URL),
  title: TITLE,
  description: DESCRIPTION,
  openGraph: {
    title: TITLE,
    description: DESCRIPTION,
    url: SITE_URL,
    siteName: "82 Showdown",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: TITLE,
    description: DESCRIPTION,
  },
};

export const viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  themeColor: "#0d1321",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>
        {children}
        <Analytics />
      </body>
    </html>
  );
}
