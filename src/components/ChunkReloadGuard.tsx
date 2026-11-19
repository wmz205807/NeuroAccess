"use client";

/**
 * 分块加载失败自动恢复（2026-11-19）
 *
 * 背景：Next.js 每次部署都会更换 chunk 哈希。用户若在部署前打开页面、之后又点导航，
 * 浏览器可能仍在请求**已删除的旧 chunk** → 404 → React 既不报错也不继续渲染，
 * 表现为「一直加载 / 白屏」，只能手动硬刷新。
 *
 * 处理：捕获 ChunkLoadError 类错误 → 自动整页刷新一次（用 sessionStorage 防循环）。
 */
import { useEffect } from "react";

const CHUNK_ERR = /ChunkLoadError|Loading chunk [\w-]+ failed|Failed to fetch dynamically imported module|Importing a module script failed/i;
const FLAG = "na-chunk-autoreload";

export default function ChunkReloadGuard() {
  useEffect(() => {
    const reloadOnce = (reason: string) => {
      try {
        if (sessionStorage.getItem(FLAG)) return; // 已经自动刷过一次，避免死循环
        sessionStorage.setItem(FLAG, String(Date.now()));
        console.warn("[chunk-guard] reloading due to:", reason.slice(0, 120));
        location.reload();
      } catch {
        location.reload();
      }
    };

    const onError = (e: ErrorEvent) => {
      const msg = String(e?.message || "");
      if (CHUNK_ERR.test(msg)) reloadOnce(msg);
    };
    const onRejection = (e: PromiseRejectionEvent) => {
      const reason: any = e?.reason;
      const msg = String(reason?.message || reason || "");
      if (CHUNK_ERR.test(msg)) reloadOnce(msg);
    };

    window.addEventListener("error", onError, true);
    window.addEventListener("unhandledrejection", onRejection);

    // 正常加载成功后清掉标记，下次部署再遇到问题仍能自动恢复
    const t = window.setTimeout(() => {
      try { sessionStorage.removeItem(FLAG); } catch {}
    }, 8000);
    return () => {
      window.removeEventListener("error", onError, true);
      window.removeEventListener("unhandledrejection", onRejection);
      window.clearTimeout(t);
    };
  }, []);

  return null;
}
