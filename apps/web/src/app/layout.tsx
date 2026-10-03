import type { Metadata } from "next";
import { Outfit, Rethink_Sans, Rubik } from "next/font/google";
import localFont from "next/font/local";

import { Chrome } from "@/components/Chrome";
import { ToastProvider } from "@/components/Toast";
import { CartProvider } from "@/lib/cart";
import { SessionProvider } from "@/lib/session";
import "./globals.css";

/* Les 4 familles relevées dans les maquettes Figma.
   Fredoka One (titres) et Rethink Sans (UI/corps) viennent du design system ;
   Outfit et Rubik n'apparaissent que dans certains écrans (footer, badge hero). */
/* Fredoka One a été retiré du catalogue Google Fonts (remplacé par la famille
   variable « Fredoka »), et `next/font/google` ne le connaît plus. On héberge
   donc le fichier d'origine pour rester fidèle à la maquette. */
const fredokaOne = localFont({
  src: "../fonts/FredokaOne-Regular.woff2",
  weight: "400",
  style: "normal",
  variable: "--font-fredoka-one",
  display: "swap",
});

const rethinkSans = Rethink_Sans({
  subsets: ["latin"],
  variable: "--font-rethink-sans",
  display: "swap",
});

const outfit = Outfit({
  subsets: ["latin"],
  variable: "--font-outfit-var",
  display: "swap",
});

const rubik = Rubik({
  subsets: ["latin"],
  variable: "--font-rubik-var",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Ojà · Marketplace d'artisanat africain",
  description:
    "Mobilier, design, décoration et artisanat façonnés à la main par des ateliers partenaires.",
  icons: {
    icon: [
      { url: "/images/logo-oja.svg", type: "image/svg+xml" },
    ],
  },
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="fr"
      className={`${fredokaOne.variable} ${rethinkSans.variable} ${outfit.variable} ${rubik.variable}`}
    >
      <body>
        <ToastProvider>
          <SessionProvider>
            <CartProvider>
              <Chrome>{children}</Chrome>
            </CartProvider>
          </SessionProvider>
        </ToastProvider>
      </body>
    </html>
  );
}
