import { NextRequest, NextResponse } from "next/server";

/**
 * Login UX gate (Phase 2).
 *
 * This middleware only checks that a session cookie EXISTS - the real HMAC
 * verification happens server-side (src/lib/server/auth.ts) on every page
 * render and API call, because the signing secret lives in the database/env
 * which the edge runtime cannot read.
 *
 * Excluded from the gate:
 *  - /login, /api/auth/*        (the gate itself)
 *  - /api/auto-pull/heartbeat   (machine route, secured by AUTO_PULL_TOKEN)
 *  - /_next, icons, manifest    (app shell assets)
 */
const PUBLIC_PREFIXES = [
  "/login",
  "/api/auth/",
  "/api/auto-pull/heartbeat",
  "/icons/",
  "/manifest.webmanifest",
  "/robots.txt",
];

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (PUBLIC_PREFIXES.some((p) => pathname.startsWith(p))) {
    return NextResponse.next();
  }

  const hasSession = !!req.cookies.get("dvv_session")?.value;
  if (!hasSession) {
    // APIs answer with JSON 401 (requireSession also enforces this server-side);
    // pages get redirected to the login screen.
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "Not signed in" }, { status: 401 });
    }
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.search = "";
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
