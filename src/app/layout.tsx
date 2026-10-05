import type { Metadata, Viewport } from "next";
import { cookies, headers } from "next/headers";
import "./globals.css";
import Sidebar from "@/components/Sidebar";
import TopNav from "@/components/TopNav";
import { DisclaimerModal, PostLoginModals } from "@/components/LazyModals";
import RoutePrefetcher from "@/components/RoutePrefetcher";
import ErrorBoundary from "@/components/ErrorBoundary";
import NotificationToast from "@/components/NotificationToast";
import PublicPreviewFooter from "@/components/PublicPreviewFooter";
import type { Lang } from "@/lib/translations";
import { LanguageProvider } from "@/lib/language-context";
import { ThemeProvider } from "@/lib/theme-context";
import { AuthProvider } from "@/lib/auth-context";
import { AnalysisProvider } from "@/lib/analysis-context";
import IntroProvider from "@/components/IntroProvider";
import { AppEventProvider } from "@/lib/app-events";

// Metadata in English (SEO default); client-side language handled by LanguageProvider
export const dynamic = "force-dynamic";

/** 站点基准信息（只写可核实的事实：免费、开源 MIT、教育用途） */
const SITE_URL = "https://neuroaccess.cloud";
const SITE_TITLE = "NeuroAccess — Free EEG Analysis & EEG Literacy Platform";
const SITE_DESCRIPTION =
  "NeuroAccess is a free, open-source EEG literacy platform for exploring EEG data, learning brainwave concepts, and understanding signal analysis through interactive tools.";
const OG_TITLE = "NeuroAccess — Understand EEG Without the Complexity";
const OG_DESCRIPTION =
  "Explore EEG data, brainwave concepts, simulations, and educational case studies through a free and open-source EEG literacy platform.";

/**
 * JSON-LD 结构化数据。只包含可验证信息：产品名、网址、免费、MIT 许可、公开仓库。
 * 刻意不写用户数量、评分、医疗认证、奖项、机构合作、科研认证等无法验证的字段。
 *
 * 注意：必须用 <script type="application/ld+json"> 输出。此前的写法是把它塞进
 * Metadata 的 other 字段，结果被输出成 <meta> 标签而不是 script —— 那是无效的，
 * 搜索引擎不会解析这些数据。
 */
const STRUCTURED_DATA = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "WebSite",
      "@id": `${SITE_URL}/#website`,
      name: "NeuroAccess",
      url: `${SITE_URL}/`,
      description: SITE_DESCRIPTION,
      inLanguage: "en",
      isAccessibleForFree: true,
    },
    {
      "@type": "SoftwareApplication",
      "@id": `${SITE_URL}/#app`,
      name: "NeuroAccess",
      url: `${SITE_URL}/`,
      description: SITE_DESCRIPTION,
      applicationCategory: "EducationalApplication",
      operatingSystem: "Web",
      isAccessibleForFree: true,
      offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
      license: "https://opensource.org/licenses/MIT",
      codeRepository: "https://github.com/wmz205807/NeuroAccess",
    },
  ],
};

export async function generateMetadata(): Promise<Metadata> {
  const baseUrl = SITE_URL;

  return {
    metadataBase: new URL(SITE_URL),
    // 具体页面（如首页 src/app/page.tsx）可覆盖；未覆盖的页面走 default
    title: { default: SITE_TITLE, template: "%s | NeuroAccess" },
    description: SITE_DESCRIPTION,
    applicationName: "NeuroAccess",
    // 这里刻意不再声明全站 canonical：旧写法让 /cases、/privacy、/terms 等页面
    // 都声明 canonical 指向首页，等于告诉搜索引擎这些页面是首页的重复内容。
    // 各页面应各自声明 canonical（首页已在 src/app/page.tsx 声明）。
    robots: {
      index: true,
      follow: true,
      googleBot: { index: true, follow: true, "max-image-preview": "large", "max-snippet": -1 },
    },
    openGraph: {
      title: OG_TITLE,
      description: OG_DESCRIPTION,
      url: baseUrl,
      siteName: "NeuroAccess",
      images: [
        {
          url: `${baseUrl}/neuroaccess-logo-512.png`,
          width: 512,
          height: 512,
          alt: "NeuroAccess",
        },
      ],
      locale: "en_US",
      type: "website",
    },
    twitter: {
      // 现有分享图是 1:1 的方形 logo，用 summary 才不会被裁切；
      // 若日后补一张 1.91:1（如 1200×630）的横幅图，再改回 summary_large_image。
      card: "summary",
      title: OG_TITLE,
      description: OG_DESCRIPTION,
      images: [`${baseUrl}/neuroaccess-logo-512.png`],
    },
    icons: {
      icon: [
        { url: "/favicon.ico?v=4", sizes: "any" },
        { url: "/favicon.png?v=4", sizes: "32x32", type: "image/png" },
        { url: "/neuroaccess-logo-small.png?v=4", sizes: "128x128", type: "image/png" },
      ],
      apple: [
        { url: "/apple-touch-icon.png?v=4", sizes: "180x180", type: "image/png" },
        { url: "/neuroaccess-logo-512.png?v=4", sizes: "512x512", type: "image/png" },
      ],
    },
    manifest: "/manifest.json?v=4",
    appleWebApp: {
      capable: true,
      statusBarStyle: "default",
      title: "NeuroAccess",
    },
  };
}

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#0a0a0a" },
  ],
  width: "device-width",
  initialScale: 1,
};

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // 从 cookie 读取用户语言偏好（SSR），无 cookie 则检测 Accept-Language
  let initialLang: Lang | undefined;
  try {
    const cookieStore = await cookies();
    const langCookie = cookieStore.get("lang");
    const LANGUAGES: Lang[] = ["zh", "en", "es", "fr", "de", "ja", "ko"];
    if (langCookie && LANGUAGES.includes(langCookie.value as Lang)) {
      initialLang = langCookie.value as Lang;
    }
  } catch {}
  if (!initialLang) {
    try {
      const headersList = await headers();
      const acceptLang = headersList.get("accept-language") || "";
      // Parse Accept-Language: "zh-CN,zh;q=0.9,en;q=0.8" → try to find best match
      const browserLangs = acceptLang.split(",").map(s => s.split(";")[0].trim().toLowerCase().split("-")[0].split("_")[0]);
      const LANGUAGES: Lang[] = ["zh", "en", "es", "fr", "de", "ja", "ko"];
      for (const bl of browserLangs) {
        if (LANGUAGES.includes(bl as Lang)) {
          initialLang = bl as Lang;
          break;
        }
      }
    } catch {}
  }
  // 默认英文
  initialLang = initialLang || "en";

  return (
    <html lang={initialLang} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{
          __html: `(function(){try{var t=localStorage.getItem("theme");if(t==="dark"||(t==="system"&&window.matchMedia("(prefers-color-scheme: dark)").matches))document.documentElement.classList.add("dark")}catch(e){}})()`
        }} />
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(STRUCTURED_DATA) }}
        />
        <link rel="shortcut icon" href="/favicon.ico?v=4" />
        <link rel="apple-touch-icon" href="/apple-touch-icon.png?v=4" />
        <link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png?v=4" />
        <link rel="apple-touch-icon" sizes="512x512" href="/neuroaccess-logo-512.png?v=4" />
      </head>
      <body className="bg-[var(--color-bg)] text-[var(--color-text)] antialiased" style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}>
        <AuthProvider>
          <ThemeProvider>
            <LanguageProvider initialLang={initialLang}>
              <AppEventProvider>
              <IntroProvider>
              <AnalysisProvider>
              <DisclaimerModal />
              <PostLoginModals />
              <NotificationToast />
              <RoutePrefetcher />
              <div className="flex h-screen overflow-hidden">
                <Sidebar />
                <div className="flex-1 flex flex-col overflow-hidden">
                  <TopNav />
                  <main className="flex-1 overflow-y-auto overflow-x-auto scroll-smooth transition-all duration-200">
                    <ErrorBoundary>
                      {children}
                    </ErrorBoundary>
                  </main>
                  <PublicPreviewFooter />
                </div>
              </div>
              </AnalysisProvider>
              </IntroProvider>
              </AppEventProvider>
            </LanguageProvider>
          </ThemeProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
