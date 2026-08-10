import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { SignOutButton } from "@/components/sign-out-button";

const NAV = [
  { href: "/studio/image", label: "Image" },
  { href: "/studio/video", label: "Video" },
  { href: "/characters", label: "Characters" },
  { href: "/presets", label: "Presets" },
  { href: "/library", label: "Library" },
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
    .select("credit_balance")
    .eq("id", user.id)
    .single();

  return (
    <div className="flex min-h-screen bg-zinc-950">
      <aside className="flex w-52 shrink-0 flex-col border-r border-zinc-800/60 px-4 py-5">
        <Link href="/" className="mb-8 text-lg font-semibold text-white">
          Creator<span className="text-violet-400">AI</span>
        </Link>
        <nav className="flex flex-col gap-1">
          {NAV.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="rounded-lg px-3 py-2 text-sm text-zinc-300 transition hover:bg-zinc-900 hover:text-white"
            >
              {item.label}
            </Link>
          ))}
        </nav>
        <div className="mt-auto space-y-3">
          <div className="rounded-lg border border-zinc-800 px-3 py-2 text-sm">
            <span className="text-zinc-400">Credits </span>
            <span className="font-medium text-white">
              {profile?.credit_balance ?? 0}
            </span>
          </div>
          <SignOutButton />
        </div>
      </aside>
      <main className="flex-1 overflow-auto">{children}</main>
    </div>
  );
}
