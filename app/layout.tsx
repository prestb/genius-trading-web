import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Genius — Trading Intelligence",
  description: "A personal multi-market analysis workspace.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
