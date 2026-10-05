"use client";

import { createContext, useContext, useState, useEffect, useRef, useCallback, ReactNode } from "react";
import { useLang } from "./language-context";

interface User {
  id: number;
  username: string;
  email: string;
  phone?: string;
  avatar_url?: string;
  avatar_color?: string;
}

interface AuthContextType {
  user: User | null;
  token: string | null;
  login: (usernameOrEmail: string, password: string, cfToken?: string) => Promise<{ success: boolean; error?: string; needsCaptcha?: boolean; termsAccepted?: boolean; needsUsernameSetup?: boolean }>;
  register: (username: string, email: string, password: string, code?: string, cfToken?: string, inviteCode?: string) => Promise<{ success: boolean; error?: string; needsCaptcha?: boolean }>;
  sendLoginCode: (email: string) => Promise<{ success: boolean; error?: string; emailSent?: string }>;
  loginWithCode: (email: string, code: string, cfToken?: string) => Promise<{ success: boolean; error?: string; needsCaptcha?: boolean; termsAccepted?: boolean; needsUsernameSetup?: boolean }>;
  logout: () => void;
  loading: boolean;
  updateUser: (user: User) => void;
  updateProfile: (data: { username?: string; avatar_color?: string }) => Promise<{ success: boolean; error?: string }>;
  changePassword: (data: { verification_code: string; new_password: string }) => Promise<{ success: boolean; error?: string }>;
  sendVerificationCode: (data: { email?: string }) => Promise<{ success: boolean; error?: string; emailSent?: string }>;
  updateEmail: (data: { new_email: string; verification_code: string }) => Promise<{ success: boolean; error?: string }>;
  sendOldEmailCode: () => Promise<{ success: boolean; error?: string; emailSent?: string }>;
  verifyOldEmail: (code: string) => Promise<{ success: boolean; error?: string }>;
  sendDeleteAccountCode: () => Promise<{ success: boolean; error?: string; emailSent?: string }>;
  deleteAccount: (data: { verification_code: string }) => Promise<{ success: boolean; error?: string }>;
  termsAccepted: boolean;
  needsUsernameSetup: boolean;
  acceptTerms: () => Promise<boolean>;
  setNeedsUsernameSetup: (v: boolean) => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "";

// ── 同意条款版本 ──────────────────────────────────────────────
// 以后更新条款时改为 "v2"，所有用户会重新看到同意弹窗
const CONSENT_VERSION = "v1";
const CONSENT_STORAGE_KEY = "neuroaccess-consent-v1";

const SECURE_COOKIE = typeof window !== "undefined" && window.location.protocol === "https:" ? "Secure; " : "";

function setAuthCookie(token: string, maxAge: number) {
  document.cookie = `neuroaccess-token=${token}; path=/; ${SECURE_COOKIE}SameSite=Lax; max-age=${maxAge}`;
}

function clearAuthCookie() {
  document.cookie = `neuroaccess-token=; path=/; ${SECURE_COOKIE}SameSite=Lax; max-age=0`;
}

// 读取 cookie（与中间件/服务端保持同一来源，避免 localStorage 与 cookie 不同步）
function readCookie(name: string): string | null {
  if (typeof document === "undefined") return null;
  const m = document.cookie.match(new RegExp("(?:^|; )" + name + "=([^;]*)"));
  return m ? decodeURIComponent(m[1]) : null;
}

interface ConsentRecord {
  accepted: boolean;
  acceptedAt: string;
  version: string;
}

/** 从 localStorage 读取同���记录（兼容版本检查） */
function loadConsent(): boolean {
  try {
    const raw = localStorage.getItem(CONSENT_STORAGE_KEY);
    if (!raw) return false;
    const record: ConsentRecord = JSON.parse(raw);
    return record.accepted === true && record.version === CONSENT_VERSION;
  } catch {
    return false;
  }
}

/** 保存同意记录到 localStorage */
function saveConsent(): void {
  try {
    const record: ConsentRecord = {
      accepted: true,
      acceptedAt: new Date().toISOString(),
      version: CONSENT_VERSION,
    };
    localStorage.setItem(CONSENT_STORAGE_KEY, JSON.stringify(record));
  } catch {
    // localStorage 不可用时忽略
  }
}

/** 清除同意记录 */
function clearConsent(): void {
  try {
    localStorage.removeItem(CONSENT_STORAGE_KEY);
  } catch {
    // ignore
  }
}

/** 解码 JWT 获取过期时间（毫秒），失败返回 null */
function decodeJwtExpiry(token: string): number | null {
  try {
    const payload = token.split(".")[1];
    if (!payload) return null;
    // Base64 URL-safe decode
    const decoded = JSON.parse(
      atob(payload.replace(/-/g, "+").replace(/_/g, "/"))
    );
    if (decoded.exp) {
      return decoded.exp * 1000; // seconds → milliseconds
    }
    return null;
  } catch {
    return null;
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [needsUsernameSetup, setNeedsUsernameSetup] = useState(false);

  // termsAccepted 从 localStorage consent 记录初始化，不依赖后端
  const [termsAccepted, setTermsAccepted] = useState(false);

  // ── 跨设备会话失效检测 ──────────────────────────────
  // 账号可能在其它设备被注销/删除，或 token 已失效。被动信任 localStorage
  // 缓存会让其它设备一直显示"已登录"，因此每次启动 / 页面重新可见时都向服务端校验一次。
  const handleSessionInvalid = useCallback(() => {
    try {
      localStorage.removeItem("neuroaccess-token");
      localStorage.removeItem("neuroaccess-user");
    } catch {}
    clearAuthCookie();
    setToken(null);
    setUser(null);
  }, []);

  // ── 跨设备报告同步 ──────────────────────────
  // 会话有效（登录成功 / 启动校验 / 页面重新可见）时调用：
  // 以服务器为真相源对账——拉取服务器报告、排除已删 id、丢弃本地残留（已删/过期快照）。
  const syncReportsOnLogin = useCallback(async () => {
    try {
      const { reconcileReportsWithServer } = await import("@/lib/reports-storage");
      await reconcileReportsWithServer();
    } catch {}
  }, []);

  const validateSession = useCallback(async (tok: string) => {
    try {
      const resp = await fetch(`${API_BASE}/api/auth/me`, {
        method: "GET",
        headers: { Authorization: `Bearer ${tok}` },
      });
      // 401 = 凭证确实失效 / 用户已被删除 → 与服务器保持一致，清除本地会话
      if (resp.status === 401) {
        handleSessionInvalid();
        return;
      }
      if (resp.ok) {
        const data = await resp.json();
        if (data && data.user) {
          setUser(data.user);
          try { localStorage.setItem("neuroaccess-user", JSON.stringify(data.user)); } catch {}
          // 条款同意状态以服务端为准（与 login() 的分支保持一致）。
          // 用户可能在其它设备已同意过；本机没有本地同意记录时，把服务端的结论补写到本地，
          // 避免同一账号换设备 / 清缓存后被重复要求勾选条款。
          // ⚠️ 新注册用户 DB terms_accepted=0 ⇒ 此分支不触发，注册后的强制性闸门照常弹出。
          if (data.user.terms_accepted && !loadConsent()) {
            saveConsent();
            setTermsAccepted(true);
          }
        }
        // 会话有效：同步跨设备报告（推送本机独有 + 拉取其它设备）
        await syncReportsOnLogin();
      }
    } catch {
      // 网络 / 服务异常：保留当前状态，下次校验再判断
    }
  }, [handleSessionInvalid, syncReportsOnLogin]);

  useEffect(() => {
    // 加载 token、用户、同意记录
    try {
      // 优先读取 cookie（服务端/中间件的鉴权来源），与服务器保持一致，
      // 避免仅读 localStorage 导致的“已登录却显示未登录 / 登录页死循环”不同步。
      const cookieToken = readCookie("neuroaccess-token");
      const savedToken = cookieToken || localStorage.getItem("neuroaccess-token");
      const savedUser = localStorage.getItem("neuroaccess-user");
      if (savedToken) {
        let parsedUser = null;
        if (savedUser) { try { parsedUser = JSON.parse(savedUser); } catch {} }
        setToken(savedToken);
        if (parsedUser) setUser(parsedUser);
        // 向服务端校验会话是否仍然有效，并补全用户信息（localStorage 可能缺失）
        validateSession(savedToken);
      }
      // 检查本地 consent 记录（页面刷新时不显示弹窗）
      if (loadConsent()) {
        setTermsAccepted(true);
      }
    } catch {}
    setLoading(false);
  }, []);

  // ── Token 过期自动登出（已禁用：用户要求永久保留登录）────
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const logoutTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const clearLogoutTimer = () => {};

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const scheduleLogout = (_jwtToken: string) => {};

  // Schedule logout on mount if token exists（已禁用）
  useEffect(() => {
    // Token 过期自动登出功能已永久禁用
    return () => {};
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  // 标签页重新可见时重新校验会话（捕捉"账号在其它设备被删除"的情况）
  useEffect(() => {
    if (typeof document === "undefined") return;
    const onVisible = () => {
      if (document.visibilityState === "visible" && token) {
        validateSession(token);
      }
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [token, validateSession]);

  const { t } = useLang();

  const tf = (key: string, fb: string) => { const v = t(key); return v === key ? fb : v; };

  const login = async (usernameOrEmail: string, password: string, cfToken?: string): Promise<{ success: boolean; error?: string; needsCaptcha?: boolean; termsAccepted?: boolean; needsUsernameSetup?: boolean }> => {
    try {
      const params = new URLSearchParams({ username_or_email: usernameOrEmail, password });
      if (cfToken) params.append("cf_turnstile_response", cfToken);
      const resp = await fetch(`${API_BASE}/api/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: params,
      });
      const data = await resp.json();
      if (data.success) {
        setToken(data.token);
        setUser(data.user);
        localStorage.setItem("neuroaccess-token", data.token);
        localStorage.setItem("neuroaccess-user", JSON.stringify(data.user));
        setAuthCookie(data.token, 5184000);
        scheduleLogout(data.token);

        const nu = !!data.needs_username_setup;
        setNeedsUsernameSetup(nu);
        if (loadConsent()) { setTermsAccepted(true); }
        else if (data.terms_accepted) { saveConsent(); setTermsAccepted(true); }
        else { setTermsAccepted(false); }
        await syncReportsOnLogin();
        return { success: true, termsAccepted: !!data.terms_accepted, needsUsernameSetup: nu };
      }
      if (data.needsCaptcha) {
        return { success: false, needsCaptcha: true, error: data.error };
      }
      return { success: false, error: data.error || data.detail || tf("loginFailed", "Login failed") };
    } catch (e: any) {
      return { success: false, error: e.message || tf("networkErrorMsg", "Network error") };
    }
  };

  const register = async (username: string, email: string, password: string, code: string = "", cfToken?: string, inviteCode?: string): Promise<{ success: boolean; error?: string; needsCaptcha?: boolean }> => {
    try {
      const params = new URLSearchParams({ username, email, password, code });
      if (cfToken) params.append("cf_turnstile_response", cfToken);
      if (inviteCode) params.append("invite_code", inviteCode);
      const resp = await fetch(`${API_BASE}/api/auth/register`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: params,
      });
      const data = await resp.json();
      if (data.success) {
        setToken(data.token);
        setUser(data.user);
        localStorage.setItem("neuroaccess-token", data.token);
        localStorage.setItem("neuroaccess-user", JSON.stringify(data.user));
        setAuthCookie(data.token, 5184000);
        scheduleLogout(data.token);

        // 新注册用户需要同意条款
        setTermsAccepted(false);
        setNeedsUsernameSetup(false);
        // 如果用户以前注册过并且同意了（比如重注册），清除旧的 consent
        // 但不影响当前这个全新注册流程
        clearConsent();
        // 清除可能遗留的旧账号 local 数据
        //（销号后从另一台设备重新注册，旧 localStorage 还在）
        const { clearReportsForUser } = await import("@/lib/reports-storage");
        clearReportsForUser(user?.id);
        localStorage.removeItem("neuroaccess-feedback");
        localStorage.removeItem("neuroaccess-survey");
        return { success: true };
      }
      if (data.needsCaptcha) {
        return { success: false, needsCaptcha: true, error: data.error };
      }
      return { success: false, error: data.error || tf("registerFailed", "Registration failed") };
    } catch (e: any) {
      return { success: false, error: e.message || tf("networkErrorMsg", "Network error") };
    }
  };

  const sendLoginCode = async (email: string): Promise<{ success: boolean; error?: string; emailSent?: string }> => {
    try {
      const resp = await fetch(`${API_BASE}/api/auth/send-login-code`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ email }),
      });
      const data = await resp.json();
      if (!resp.ok) {
        return { success: false, error: data.detail || data.error || tf("sendCodeFailed", "Failed to send code") };
      }
      if (data.success) {
        // emailSent 是「邮件是否真的发出」的唯一真源：'已发送' | 'not_configured' | 'failed'。
        // success 只代表验证码已生成入库，不能拿来当「已发送」用。
        return { success: true, emailSent: data.email_sent };
      }
      return { success: false, error: data.error || tf("sendCodeFailed", "Failed to send code") };
    } catch (e: any) {
      return { success: false, error: e.message || tf("networkErrorMsg", "Network error") };
    }
  };

  const loginWithCode = async (email: string, code: string, cfToken?: string): Promise<{ success: boolean; error?: string; needsCaptcha?: boolean; termsAccepted?: boolean; needsUsernameSetup?: boolean }> => {
    try {
      const params = new URLSearchParams({ email, code });
      if (cfToken) params.append("cf_turnstile_response", cfToken);
      const resp = await fetch(`${API_BASE}/api/auth/login-with-code`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: params,
      });
      const data = await resp.json();
      if (data.success) {
        setToken(data.token);
        setUser(data.user);
        localStorage.setItem("neuroaccess-token", data.token);
        localStorage.setItem("neuroaccess-user", JSON.stringify(data.user));
        setAuthCookie(data.token, 5184000);
        scheduleLogout(data.token);
        const nu = !!data.needs_username_setup;
        setNeedsUsernameSetup(nu);
        if (loadConsent()) {
          setTermsAccepted(true);
        } else if (data.terms_accepted) {
          saveConsent();
          setTermsAccepted(true);
        }
        await syncReportsOnLogin();
        return { success: true, termsAccepted: !!data.terms_accepted, needsUsernameSetup: nu };
      }
      if (data.needsCaptcha) {
        return { success: false, needsCaptcha: true, error: data.error };
      }
      return { success: false, error: data.error || tf("verificationCodeFailed", "Verification failed") };
    } catch (e: any) {
      return { success: false, error: e.message || tf("networkErrorMsg", "Network error") };
    }
  };

  const sendOldEmailCode = async (): Promise<{ success: boolean; error?: string; emailSent?: string }> => {
    if (!token) return { success: false, error: tf("notLoggedIn", "Not logged in") };
    try {
      const resp = await fetch(`${API_BASE}/api/auth/send-old-email-code`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      const result = await resp.json();
      if (!resp.ok) {
        return { success: false, error: result.detail || result.error || tf("sendCodeFailed", "Failed to send code") };
      }
      if (result.success) return { success: true, emailSent: result.email_sent };
      return { success: false, error: result.error || tf("sendCodeFailed", "Failed to send code") };
    } catch (e: any) {
      return { success: false, error: e.message || tf("networkErrorMsg", "Network error") };
    }
  };

  const verifyOldEmail = async (code: string): Promise<{ success: boolean; error?: string }> => {
    if (!token) return { success: false, error: tf("notLoggedIn", "Not logged in") };
    try {
      const resp = await fetch(`${API_BASE}/api/auth/verify-old-email`, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Authorization: `Bearer ${token}`,
        },
        body: new URLSearchParams({ code }),
      });
      const result = await resp.json();
      if (result.success) return { success: true };
      return { success: false, error: result.error || tf("verificationCodeFailed", "Verification failed") };
    } catch (e: any) {
      return { success: false, error: e.message || tf("networkErrorMsg", "Network error") };
    }
  };

  const acceptTerms = async (): Promise<boolean> => {
    // 1. 始终保存到 localStorage（离线场景也生效）
    saveConsent();
    setTermsAccepted(true);

    // 2. 同时同步到后端（接收失败不影响本地）
    if (!token) return true;
    try {
      const resp = await fetch(`${API_BASE}/api/auth/accept-terms`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (resp.status === 401) {
        // token 过期 → 不清除本地 consent，只是静默忽略后端同步
        return true;
      }
      const data = await resp.json();
      return data.success !== false; // 后端失败也不影响本地
    } catch {
      return true; // 网络错误也不影响本地
    }
  };

  const updateProfile = async (data: { username?: string; avatar_color?: string }): Promise<{ success: boolean; error?: string }> => {
    if (!token) return { success: false, error: tf("notLoggedIn", "Not logged in") };
    try {
      const resp = await fetch(`${API_BASE}/api/auth/profile`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(data),
      });
      const result = await resp.json();
      if (result.success) {
        const updatedUser = result.user ? { ...(user || {}), ...result.user } as User : user!;
        if (updatedUser) {
          setUser(updatedUser);
          localStorage.setItem("neuroaccess-user", JSON.stringify(updatedUser));
        }
        return { success: true };
      }
      return { success: false, error: result.error || tf("failedToUpdateProfile", "Profile update failed") };
    } catch (e: any) {
      return { success: false, error: e.message || tf("networkErrorMsg", "Network error") };
    }
  };

  const changePassword = async (data: { verification_code: string; new_password: string }): Promise<{ success: boolean; error?: string }> => {
    if (!token) return { success: false, error: tf("notLoggedIn", "Not logged in") };
    try {
      const resp = await fetch(`${API_BASE}/api/auth/change-password`, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Authorization: `Bearer ${token}`,
        },
        body: new URLSearchParams({
          verification_code: data.verification_code,
          new_password: data.new_password,
        }),
      });
      const result = await resp.json();
      if (result.success) {
        return { success: true };
      }
      return { success: false, error: result.error || tf("failedToChangePasswordMsg", "Password change failed") };
    } catch (e: any) {
      return { success: false, error: e.message || tf("networkErrorMsg", "Network error") };
    }
  };

  const sendVerificationCode = async (data: { email?: string }): Promise<{ success: boolean; error?: string; emailSent?: string }> => {
    if (!token) return { success: false, error: tf("notLoggedIn", "Not logged in") };
    try {
      const resp = await fetch(`${API_BASE}/api/auth/verification-code`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });
      let result: any;
      try {
        result = await resp.json();
      } catch {
        result = { detail: tf("sendCodeFailed", "Failed to send verification code") };
      }
      if (!resp.ok) {
        return { success: false, error: result.detail || result.error || tf("sendCodeFailed", "Failed to send verification code") };
      }
      if (result.success) {
        return { success: true, emailSent: result.email_sent };
      }
      return { success: false, error: result.error || tf("sendFailed", "Send failed") };
    } catch (e: any) {
      return { success: false, error: e.message || tf("networkErrorMsg", "Network error") };
    }
  };

  const updateEmail = async (data: { new_email: string; verification_code: string }): Promise<{ success: boolean; error?: string }> => {
    if (!token) return { success: false, error: tf("notLoggedIn", "Not logged in") };
    try {
      const resp = await fetch(`${API_BASE}/api/auth/confirm-email-change`, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Authorization: `Bearer ${token}`,
        },
        body: new URLSearchParams({
          new_email: data.new_email,
          verification_code: data.verification_code,
        }),
      });
      const result = await resp.json();
      if (result.success) {
        if (result.user) {
          const updatedUser = { ...(user || {}), ...result.user } as User;
          setUser(updatedUser);
          localStorage.setItem("neuroaccess-user", JSON.stringify(updatedUser));
        }
        return { success: true };
      }
      return { success: false, error: result.error || "Email change failed" };
    } catch (e: any) {
      return { success: false, error: e.message || tf("networkErrorMsg", "Network error") };
    }
  };

  const sendDeleteAccountCode = async (): Promise<{ success: boolean; error?: string; emailSent?: string }> => {
    if (!token) return { success: false, error: tf("notLoggedIn", "Not logged in") };
    try {
      const resp = await fetch(`${API_BASE}/api/auth/send-delete-account-code`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });
      let result: any;
      try {
        result = await resp.json();
      } catch {
        result = { detail: tf("sendCodeFailed", "Failed to send verification code") };
      }
      if (!resp.ok) {
        return { success: false, error: result.detail || result.error || tf("sendCodeFailed", "Failed to send verification code") };
      }
      if (result.success) {
        return { success: true, emailSent: result.email_sent };
      }
      return { success: false, error: result.error || tf("sendFailed", "Send failed") };
    } catch (e: any) {
      return { success: false, error: e.message || tf("networkErrorMsg", "Network error") };
    }
  };

  const deleteAccount = async (data: { verification_code: string }): Promise<{ success: boolean; error?: string }> => {
    if (!token) return { success: false, error: tf("notLoggedIn", "Not logged in") };
    try {
      const resp = await fetch(`${API_BASE}/api/auth/confirm-delete-account`, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Authorization: `Bearer ${token}`,
        },
        body: new URLSearchParams({
          verification_code: data.verification_code,
        }),
      });
      const result = await resp.json();
      if (!resp.ok) {
        return { success: false, error: result.detail || result.error || tf("deleteAccountFailed", "Account deletion failed") };
      }
      if (result.success) {
        setToken(null);
        setUser(null);
        setTermsAccepted(false);
        setNeedsUsernameSetup(false);
        localStorage.removeItem("neuroaccess-token");
        // 删除账号：清除该用户的本地报告/收藏/已删记录缓存
        const { clearReportsForUser } = await import("@/lib/reports-storage");
        clearReportsForUser(user?.id);
        localStorage.removeItem("neuroaccess-user");
        localStorage.removeItem("neuroaccess-feedback");
        localStorage.removeItem("neuroaccess-survey");
        // 删除账号时清除同意记录，同时清掉认证 Cookie（与 logout/handleSessionInvalid 一致），
        // 否则销号后 cookie 残留（max-age 60 天）会导致下次访问短暂显示"已登录"
        clearConsent();
        clearAuthCookie();
        return { success: true };
      }
      return { success: false, error: result.error || tf("deleteAccountFailed", "Account deletion failed") };
    } catch (e: any) {
      return { success: false, error: e.message || tf("networkErrorMsg", "Network error") };
    }
  };

  const logout = () => {
    setToken(null);
    setUser(null);
    setTermsAccepted(false);
    setNeedsUsernameSetup(false);
    localStorage.removeItem("neuroaccess-token");
    localStorage.removeItem("neuroaccess-user");
    // 注销时清除问卷本地记录，防止未登录状态下看到已提交状态
    localStorage.removeItem("neuroaccess-survey");
    // 注销时 NOT 清除同意记录，这样重新登录后不再显示弹窗
    // 只有用户主动删除账号才会清除
    clearAuthCookie();
  };

  const updateUser = (updatedUser: User) => {
    setUser(updatedUser);
    localStorage.setItem("neuroaccess-user", JSON.stringify(updatedUser));
  };

  return (
    <AuthContext.Provider value={{ user, token, login, register, sendLoginCode, loginWithCode, logout, loading, updateUser, updateProfile, changePassword, sendVerificationCode, updateEmail, sendOldEmailCode, verifyOldEmail, sendDeleteAccountCode, deleteAccount, termsAccepted, needsUsernameSetup, acceptTerms, setNeedsUsernameSetup }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
