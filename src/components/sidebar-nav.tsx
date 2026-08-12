"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Home,
  Image as ImageIcon,
  Video,
  Users,
  Sparkles,
  LibraryBig,
  Settings,
  type LucideIcon,
} from "lucide-react";

const NAV: { href: string; label: string; icon: LucideIcon }[] = [
  { href: "/home", label: "Home", icon: Home },
  { href: "/studio/image", label: "Image", icon: ImageIcon },
  { href: "/studio/video", label: "Video", icon: Video },
  { href: "/characters", label: "Characters", icon: Users },
  { href: "/presets", label: "Presets", icon: Sparkles },
  { href: "/library", label: "Library", icon: LibraryBig },
  { href: "/account", label: "Account", icon: Settings },
];

export function SidebarNav() {
  const pathname = usePathname();

  return (
    <nav className="flex flex-col gap-1">
      {NAV.map((item) => {
        const active =
          pathname === item.href || pathname.startsWith(`${item.href}/`);
        const Icon = item.icon;

        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={`flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition ${
              active
                ? "bg-violet-500/15 text-violet-300 light:bg-violet-100 light:text-violet-700"
                : "text-zinc-300 light:text-zinc-600 hover:bg-zinc-900 light:hover:bg-zinc-100 hover:text-white light:hover:text-zinc-900"
            }`}
          >
            <Icon className="size-4 shrink-0" strokeWidth={2} />
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
