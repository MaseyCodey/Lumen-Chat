import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Lumen Chat",
  description: "Private real-time direct and group messaging for teams and classrooms."
};

export const viewport: Viewport = {
  themeColor: "#f7f4ee"
};

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
