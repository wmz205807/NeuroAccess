"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";

/** 游客（未登录）也会访问的公开路由 */
const PUBLIC_ROUTES = ["/", "/guide", "/cases", "/eeg-simulator"];

/** 仅登录用户才会用到的路由 */
const AUTH_ROUTES = ["/reports", "/account"];

/**
 * 页面加载后预加载常用路由的 JS chunk，消除首次页面切换延迟。
 *
 * 注意：这里刻意只预取「主要入口」。此前固定预取 11 条路由（含 /login、
 * /register、/privacy、/terms、/disclaimer 这些极少需要立即跳转的页面），
 * 每次页面加载都会额外发出约 19 个 RSC 请求，在高延迟链路上会与首屏争抢带宽。
 */
export default function RoutePrefetcher() {
  const router = useRouter();
  const { user } = useAuth();

  useEffect(() => {
    const routes = user ? [...PUBLIC_ROUTES, ...AUTH_ROUTES] : PUBLIC_ROUTES;
    // 延迟 500ms 后开始预加载，不干扰首屏渲染
    const timer = setTimeout(() => {
      try {
        for (const route of routes) {
          router.prefetch(route);
        }
      } catch {}
    }, 500);
    return () => clearTimeout(timer);
  }, [router, user]);

  return null;
}
