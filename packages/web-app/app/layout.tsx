import type { Metadata } from "next";

import "./globals.css";

export const metadata: Metadata = {
  title: "Deep Agent UI",
  description: "Generative JSON UI shell for the agent.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
