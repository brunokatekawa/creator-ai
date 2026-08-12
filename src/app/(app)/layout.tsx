import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { UserMenu } from "@/components/user-menu";

const NAV = [
  { href: "/home", label: "Home" },
  { href: "/studio/image", label: "Image" },
  { href: "/studio/video", label: "Video" },
  { href: "/characters", label: "Characters" },
  { href: "/presets", label: "Presets" },
  { href: "/library", label: "Library" },
  { href: "/account", label: "Account" },
];

export default async function AppLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("credit_balance, username")
    .eq("id", user.id)
    .single();

  return (
    <div className="flex min-h-screen bg-zinc-950 light:bg-white">
      <aside className="flex w-52 shrink-0 flex-col border-r border-zinc-800/60 light:border-zinc-200 px-4 py-5">
        <Link href="/home" className="mb-8 text-lg font-semibold text-white light:text-zinc-900">
          Creator<span className="text-violet-400">AI</span>
        </Link>
        <nav className="flex flex-col gap-1">
          {NAV.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="rounded-lg px-3 py-2 text-sm text-zinc-300 light:text-zinc-600 transition hover:bg-zinc-900 light:hover:bg-zinc-100 hover:text-white light:hover:text-zinc-900"
            >
              {item.label}
            </Link>
          ))}
        </nav>
        <div className="mt-auto space-y-3">
          <div className="rounded-lg border border-zinc-800 light:border-zinc-200 px-3 py-2 text-sm">
            <span className="text-zinc-400 light:text-zinc-500">Credits </span>
            <span className="font-medium text-white light:text-zinc-900">
              {profile?.credit_balance ?? 0}
            </span>
          </div>
          <UserMenu email={user.email ?? ""} username={profile?.username ?? null} />
        </div>
      </aside>
      <main className="flex-1 overflow-auto">{children}</main>
    </div>
  );
}
