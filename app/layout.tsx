import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Override — Last-Minute Life Saver",
  description: "AI deadline-crisis companion powered by Google Gemini.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark">
      <body className="bg-[#0a0a0a] text-white antialiased">{children}</body>
    </html>
  );
}
