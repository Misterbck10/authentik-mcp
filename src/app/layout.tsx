import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = { title: "authentik MCP", robots: { index: false } };

const bodyStyle = {
  fontFamily: "system-ui, sans-serif",
  margin: 0,
  padding: "1rem",
  minHeight: "100vh",
  boxSizing: "border-box" as const,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  background: "#7d9a85",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body style={bodyStyle}>{children}</body>
    </html>
  );
}
