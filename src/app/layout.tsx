import type { Metadata } from "next";
import type { ReactNode } from "react";
import { ThemeProvider } from "next-themes";
import { TeleZapMark, TeleZapWordmark } from "@/components/telezap-logo";
import { ThemeToggle } from "@/components/theme-toggle";
import { Separator } from "@/components/ui/separator";
import "./globals.css";

export const metadata: Metadata = {
  title: "TeleZap Group Contacts Exporter",
  description: "Export WhatsApp and Telegram group participants to CSV",
  icons: {
    icon: [
      { url: "/telezap-icon.svg", type: "image/svg+xml" },
      { url: "/favicon.ico", sizes: "16x16", type: "image/x-icon" },
    ],
  },
};

export default function RootLayout({ children }: { children: ReactNode }): ReactNode {
  return (
    <html lang="pt-BR" suppressHydrationWarning>
      <body>
        <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
          <div className="mx-auto w-full max-w-3xl px-4 pb-16">
            <header className="flex items-center justify-between gap-4 py-5">
              <div className="flex items-center gap-3 text-primary">
                <TeleZapMark size={36} />
                <TeleZapWordmark className="text-lg text-foreground sm:text-xl" />
              </div>
              <ThemeToggle />
            </header>
            <Separator className="mb-6" />
            <main>{children}</main>
          </div>
        </ThemeProvider>
      </body>
    </html>
  );
}
