import type { Metadata, Viewport } from "next";
import "./globals.css";
import Nav from "@/components/Nav";

export const metadata: Metadata = {
  title: "Grile",
  description: "Aplicație de grile pentru examen",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ro">
      <body>
        <Nav />
        <main className="mx-auto max-w-3xl px-4 py-5 sm:py-6">{children}</main>
      </body>
    </html>
  );
}
