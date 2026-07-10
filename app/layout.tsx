import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "xgif.cn — 值得看的，三分钟看懂",
  description: "整理有趣文章摘要、网络热点、图片和表情包的轻内容站。",
  openGraph: {
    title: "xgif.cn — 值得看的，三分钟看懂",
    description: "文章负责信息整理，图片负责表达与传播。",
    type: "website",
    images: [{ url: "/og.png", width: 1200, height: 630, alt: "xgif.cn" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "xgif.cn — 值得看的，三分钟看懂",
    description: "文章负责信息整理，图片负责表达与传播。",
    images: ["/og.png"],
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body className={`${geistSans.variable} ${geistMono.variable}`}>{children}</body>
    </html>
  );
}
