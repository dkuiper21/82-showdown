import "./globals.css";
import { Analytics } from "@vercel/analytics/next";

export const metadata = {
  title: "82 Showdown — Head-to-Head NBA Draft",
  description:
    "Draft an 8-man rotation from random NBA seasons and battle a friend in a best-of-7 series.",
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
