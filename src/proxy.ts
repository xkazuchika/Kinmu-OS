import { NextRequest, NextResponse } from "next/server";

const unsafeMethods = new Set(["DELETE", "PATCH", "POST", "PUT"]);

function allowedOrigins(request: NextRequest) {
  const origins = new Set([request.nextUrl.origin]);
  try {
    if (process.env.APP_URL) origins.add(new URL(process.env.APP_URL).origin);
  } catch {
    // Startup environment validation reports an invalid APP_URL with a clearer error.
  }
  return origins;
}

export function proxy(request: NextRequest) {
  if (request.nextUrl.pathname.startsWith("/api/") && unsafeMethods.has(request.method)) {
    const origin = request.headers.get("origin");
    const fetchSite = request.headers.get("sec-fetch-site");
    if ((origin && !allowedOrigins(request).has(origin)) || fetchSite === "cross-site") {
      return NextResponse.json({ error: "不正な送信元からのリクエストです。" }, { status: 403 });
    }
  }
  const response = NextResponse.next();
  response.headers.set(
    "Content-Security-Policy",
    "default-src 'self'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'; object-src 'none'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'",
  );
  response.headers.set("Permissions-Policy", "camera=(), geolocation=(), microphone=()");
  response.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  response.headers.set("X-Content-Type-Options", "nosniff");
  response.headers.set("X-Frame-Options", "DENY");
  return response;
}

export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"] };
