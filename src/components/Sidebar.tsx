"use client";

import { useState, useMemo, useEffect } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useLang } from "@/lib/language-context";
const SettingsPanel = dynamic(() => import("./SettingsPanel"), { ssr: false, loading: () => null });
import { useAuth } from "@/lib/auth-context";
import { Brain,
  LayoutDashboard,
  FileText,
  BookOpen,
  Stethoscope,
  Activity,
  ChevronLeft,
  ChevronRight,
  Settings,
} from "lucide-react";
import { useAppEvents } from "@/lib/app-events";

const menuKeys = [
  { key: "dashboard", href: "/", icon: LayoutDashboard },
  { key: "reports", href: "/reports", icon: FileText },
  { key: "sidebarGuide", href: "/guide", icon: BookOpen },
  { key: "cases", href: "/cases", icon: Stethoscope },
  { key: "eegSimulator", href: "/eeg-simulator", icon: Activity },
];

export default function Sidebar() {
  const [collapsed, setCollapsed] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const pathname = usePathname();
  const { lang, t } = useLang();
  const { user } = useAuth();
  const { setOpenSettings } = useAppEvents();

  // 暴露全局方法供 TopNav 调用
  useEffect(() => {
    setOpenSettings(() => () => setSettingsOpen(true));
  }, [setOpenSettings]);

  // 语言 / 登录状态变化时重新计算菜单标签
  // 游客与登录用户共用同一套侧边栏，保持网站布局一致；
  // 仅隐藏需要账户的「报告」入口（与移动端游客菜单行为一致）。
  const menuItems = useMemo(() => {
    const keys = user ? menuKeys : menuKeys.filter((item) => item.href !== "/reports");
    return keys.map(item => ({
      ...item,
      label: t(item.key),
    }));
  }, [lang, user]);

  return (
    <aside
      className={`bg-[var(--color-surface)] border-r border-[var(--color-border)] flex flex-col transition-[width] duration-300 hidden lg:flex ${
        collapsed ? "w-[68px]" : "w-[240px]"
      }`}
    >
      {/* Logo */}
      <div className="h-14 flex items-center px-4 border-b border-[var(--color-border)]">
        <div className="flex items-center gap-2.5">
          <img src="/neuroaccess-logo-small.png" alt="NeuroAccess" width={32} height={32} className="w-8 h-8 rounded-lg object-contain bg-[var(--color-bg)]" />
          {!collapsed && (
            <span className="font-bold tracking-tight text-[var(--color-text)]">NeuroAccess</span>
          )}
        </div>
      </div>

      {/* 导航菜单 */}
      <nav className="flex-1 py-4 overflow-y-auto">
        <ul className="space-y-1 px-2">
          {menuItems.map((item) => {
            const isActive = pathname === item.href;
            const Icon = item.icon;

            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  className={`flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm transition-colors duration-200 ${
                    isActive
                      ? "bg-[var(--color-primary)] text-[var(--color-surface)] shadow-lg shadow-[var(--color-primary)_/10]"
                      : "text-[var(--color-text-secondary)] hover:bg-[var(--color-bg)] hover:text-[var(--color-text)]"
                  }`}
                >
                  <Icon className="w-5 h-5 flex-shrink-0" />
                  {!collapsed && <span className="font-medium">{item.label}</span>}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      {/* 底部：设置 + 折叠 */}
      <div className="p-4 border-t border-[var(--color-border)] space-y-1">
        <button
          onClick={() => setSettingsOpen(true)}
          className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm transition-colors ${
            collapsed ? "justify-center" : ""
          } ${
            settingsOpen
              ? "bg-[var(--color-primary)] text-[var(--color-surface)]"
              : "text-[var(--color-text-secondary)] hover:bg-[var(--color-bg)] hover:text-[var(--color-text)]"
          }`}
        >
          <Settings className="w-5 h-5 flex-shrink-0" />
          {!collapsed && <span className="font-medium">{t("settings")}</span>}
        </button>

        <button
          onClick={() => setCollapsed(!collapsed)}
          className="w-full flex items-center justify-center p-2 rounded-xl hover:bg-[var(--color-bg)] transition-colors"
        >
          {collapsed ? (
            <ChevronRight className="w-4 h-4 text-[var(--color-text-secondary)]" />
          ) : (
            <ChevronLeft className="w-4 h-4 text-[var(--color-text-secondary)]" />
          )}
        </button>
      </div>

      {/* 设置面板 */}
      {settingsOpen && <SettingsPanel open={settingsOpen} onClose={() => setSettingsOpen(false)} />}
    </aside>
  );
}
