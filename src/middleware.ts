import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

// 未登录时可访问的「目录/前缀」路径：法律条款页、教育内容、静态资源、API
// 注意：这里每一项都按 pathname === p 或 pathname.startsWith(p + "/") 匹配，
// 所以不要放 "/"（会放行整站）。首页单独放在 publicExact 里精确匹配。
const publicPaths = [
  "/login", "/register",
  // 2026-10-27（用户要求）：未登录只放行「免责声明 / 隐私政策 / 服务条款」三个政策页，
  // 其余页面（含教育内容）一律强制回登录页。游客想浏览必须先点「以游客身份浏览」。
  "/privacy", "/terms", "/disclaimer",
  // 静态资源与 API
  "/api/",
  "/_next/",
  "/favicon.ico", "/favicon.png", "/icon.svg",
  "/apple-touch-icon.png", "/manifest.json",
  "/neuroaccess-logo.png", "/neuroaccess-logo-512.png",
  "/neuroaccess-logo-small.png", "/neuroaccess-logo.jpg",
  "/neuroaccess-logo-fixed.png",
  "/opengraph-image.png", "/twitter-image.png",
  "/robots.txt", "/sitemap.xml",
  "/downloads/",
];

// 2026-10-27：首页不再无条件公开（未登录会被拦回登录页）；
// 只有「已选择游客身份」（见下方 guest cookie）才放行。
const publicExact: string[] = [];

// 游客身份 cookie（由登录页「以游客身份浏览」按钮写入，会话级，关浏览器即失效）
const GUEST_COOKIE = "na-guest-entry";
// 游客模式下允许浏览的页面（报告/账户仍需登录）
const guestAllowed = ["/", "/guide", "/cases", "/eeg-simulator"];


const SECRET = process.env.JWT_SECRET_KEY || "";

function b64urlToUint8(s: string): Uint8Array {
  const pad = s.length % 4 === 0 ? "" : "=".repeat(4 - (s.length % 4));
  const b64 = (s + pad).replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function b64urlDecode(s: string): any {
  const bin = b64urlToUint8(s);
  return JSON.parse(new TextDecoder().decode(bin));
}

/** 验证 JWT 签名（HS256）与过期时间 */
async function isValidToken(token: string): Promise<boolean> {
  try {
    // fail-closed：没有密钥一律视为无效，绝不放过伪造 token（不能裸校验 exp）
    if (!SECRET) return false;
    const parts = token.split(".");
    if (parts.length !== 3) return false;
    const [headerB64, payloadB64, sigB64] = parts;

    // 1) 校验签名（需要 JWT_SECRET_KEY）
    const key = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(SECRET),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["verify"]
    );
    const valid = await crypto.subtle.verify(
      "HMAC",
      key,
      b64urlToUint8(sigB64).buffer as ArrayBuffer,
      new TextEncoder().encode(`${headerB64}.${payloadB64}`)
    );
    if (!valid) return false;

    // 2) 校验过期时间
    const payload = b64urlDecode(payloadB64);
    if (payload && typeof payload.exp === "number") {
      if (payload.exp * 1000 < Date.now()) return false;
    }
    return true;
  } catch {
    return false;
  }
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const token = request.cookies.get("neuroaccess-token")?.value;

  const isPublic = publicExact.includes(pathname) || publicPaths.some((p) => {
    if (p.endsWith("/")) return pathname.startsWith(p); // 目录前缀（/api/、/_next/、/downloads/）
    return pathname === p || pathname.startsWith(p + "/"); // 精确路径，防 /termsxxx 误放行
  });
  const tokenValid = token ? await isValidToken(token) : false;
  // 游客身份：cookie 存在且当前路径在游客可用范围内 ⇒ 放行（人机验证/三协议由前端把关）
  const guestEntry = request.cookies.get(GUEST_COOKIE)?.value === "1";
  const guestPathOk = guestEntry && guestAllowed.some((p) => pathname === p || pathname.startsWith(p + "/"));

  // 已登录（token 有效）访问登录/注册页 → 重定向首页
  if (tokenValid && (pathname === "/login" || pathname === "/register")) {
    const url = request.nextUrl.clone();
    url.pathname = "/";
    return NextResponse.redirect(url);
  }

  // 公开路径 / 已验证游客身份可浏览的页面 → 直接放行
  if (isPublic || guestPathOk) {
    const res = NextResponse.next();
    // 页面文档禁止强缓存，始终重新校验，部署新版本后刷新即可生效
    res.headers.set("Cache-Control", "no-cache");
    return res;
  }

  // token 不存在或无效 → 强制跳登录页
  if (!tokenValid) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    // 附上原始目标，登录后可回跳
    if (pathname !== "/" && pathname !== "/login") {
      url.searchParams.set("redirect", pathname);
    }
    return NextResponse.redirect(url);
  }

  const res = NextResponse.next();
  res.headers.set("Cache-Control", "no-cache");
  return res;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
  // Node.js runtime：让 middleware 在运行时读取 process.env（Edge 不会内联非 NEXT_PUBLIC 变量），
  // 这样 JWT_SECRET_KEY 由 pm2 注入后签名校验才能真正生效。
  runtime: "nodejs",
};
