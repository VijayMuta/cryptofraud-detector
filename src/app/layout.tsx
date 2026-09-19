import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "CHAINTRACE | CryptoFraud Detector",
  description: "Trace the Money. Detect the Pattern. Connect the Cases.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="bg-slate-950 text-slate-300 min-h-screen">
        {children}
      </body>
    </html>
  );
}
