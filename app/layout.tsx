import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Override — AI Emergency Decision Engine",
  description: "AI Decision Engine for Emergencies",
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
