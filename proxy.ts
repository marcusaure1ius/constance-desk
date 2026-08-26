import { NextRequest, NextResponse } from "next/server";
import { isSessionValid, SESSION_COOKIE } from "@/lib/session";

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Пропускаем статику, API авторизации и страницу логина
  if (
    pathname.startsWith("/login") ||
    pathname.startsWith("/api/auth") ||
    pathname.startsWith("/_next") ||
    pathname.startsWith("/favicon")
  ) {
    return NextResponse.next();
  }

  // API Routes проверяют X-API-Key сами
  if (pathname.startsWith("/api/")) {
    return NextResponse.next();
  }

  // Проверяем сессию для защищённых страниц
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  if (!(await isSessionValid(token))) {
    return NextResponse.redirect(new URL("/login", request.url));
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
