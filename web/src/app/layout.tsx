import type { Metadata } from "next";
import { Geist, Geist_Mono, Instrument_Serif } from "next/font/google";
import "./globals.css";
import { Providers } from "@/components/shell/context";
import { AppShell } from "@/components/shell/AppShell";

const geist = Geist({ variable: "--font-geist", subsets: ["latin"], weight: ["400", "500", "600"], display: "swap" });
const instrumentSerif = Instrument_Serif({ variable: "--font-instrument-serif", subsets: ["latin"], weight: "400", style: ["italic"], display: "swap" });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"], weight: ["400", "500"], display: "swap" });

export const metadata: Metadata = {
  title: "Kindred",
  description: "Clay finds leads. Kindred tells you why now and who can introduce you, and proves every claim.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className={`${geist.variable} ${instrumentSerif.variable} ${geistMono.variable} text-neutral-900 antialiased`}>
        <Providers>
          <AppShell>{children}</AppShell>
        </Providers>
      </body>
    </html>
  );
}
