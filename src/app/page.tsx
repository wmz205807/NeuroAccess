import type { Metadata } from "next";
import DashboardClient from "@/components/DashboardClient";

const SITE_URL = "https://neuroaccess.cloud";

/**
 * 首页专属元数据（覆盖 layout 里的站点默认值）。
 * 只声明可核实的事实：免费、开源（MIT）、教育用途 —— 不写任何医疗/诊断类文案，
 * 也不写用户量、评分、认证、奖项、机构合作等无法验证的信息。
 */
export const metadata: Metadata = {
  title: "NeuroAccess — Free EEG Analysis & EEG Literacy Platform",
  description:
    "NeuroAccess is a free, open-source EEG literacy platform for exploring EEG data, learning brainwave concepts, and understanding signal analysis through interactive tools.",
  alternates: { canonical: "/" },
  openGraph: {
    title: "NeuroAccess — Understand EEG Without the Complexity",
    description:
      "Explore EEG data, brainwave concepts, simulations, and educational case studies through a free and open-source EEG literacy platform.",
    url: `${SITE_URL}/`,
    siteName: "NeuroAccess",
    images: [
      {
        url: "/neuroaccess-logo-512.png",
        width: 512,
        height: 512,
        alt: "NeuroAccess",
      },
    ],
    locale: "en_US",
    type: "website",
  },
  twitter: {
    // 首页声明 twitter 字段时会整体覆盖 layout 里的 twitter 配置，因此这里必须
    // 显式写 card —— 否则 Next.js 会填入默认值 summary_large_image（现有分享图是
    // 1:1 方形 logo，summary 的小方图更合适，不会被裁切）。
    card: "summary",
    title: "NeuroAccess — Understand EEG Without the Complexity",
    description:
      "Explore EEG data, brainwave concepts, simulations, and educational case studies through a free and open-source EEG literacy platform.",
    images: ["/neuroaccess-logo-512.png"],
  },
};

/**
 * 首页是服务端组件：它只负责输出 metadata 并挂载客户端仪表盘。
 * 首屏 HTML 的正文来自 <DashboardClient /> 的服务端渲染结果（见该文件里 loading 分支的说明），
 * 因此核心内容不依赖客户端 JavaScript 加载后才出现。
 */
export default function HomePage() {
  return <DashboardClient />;
}
