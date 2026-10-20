import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = { title: "authentik MCP", robots: { index: false } };

const bodyStyle = {
  fontFamily: "system-ui, sans-serif",
  maxWidth: "45rem",
  margin: "3rem auto",
  padding: "0 1rem",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body style={bodyStyle}>{children}</body>
    </html>
  );
}
