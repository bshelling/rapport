import type { Metadata, Viewport } from "next";
import { Public_Sans } from "next/font/google";
import { AuthProvider } from "@/components/auth-provider";
import { SiteHeader } from "@/components/site-header";
import "./globals.css";

const publicSans = Public_Sans({
  variable: "--font-public-sans",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Rapport — Report street and drainage issues in New Orleans",
  description:
    "Report potholes, street damage and catch basins that need cleaning in New Orleans.",
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#fbfaf7" },
    { media: "(prefers-color-scheme: dark)", color: "#121116" },
  ],
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${publicSans.variable} h-full antialiased`}>
      <body className="flex min-h-full flex-col font-sans">
        <AuthProvider>
          <div className="mx-auto w-full max-w-5xl px-4 pt-8 sm:px-8 sm:pt-12">
            <SiteHeader />
          </div>
          {children}
        </AuthProvider>
      </body>
    </html>
  );
}
