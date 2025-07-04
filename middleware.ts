import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { GraphQLClient } from "graphql-request";

const BASEBASE_ENDPOINT = "https://app.basebase.us/graphql";

const PUBLIC_API_ROUTES = [
  "/api/auth/signin",
  "/api/auth/verify",
  "/api/health",
  "/api/preview",
];

const ADMIN_API_ROUTES = ["/api/admin/rescrape"];

// Function to validate token with BaseBase
async function validateToken(token: string): Promise<boolean> {
  try {
    const client = new GraphQLClient(BASEBASE_ENDPOINT, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    // Make a simple query to validate the token
    await client.request(`
      query ValidateToken {
        me {
          id
        }
      }
    `);

    return true;
  } catch (error) {
    console.error("Token validation error:", error);
    return false;
  }
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Protect all API routes by default
  if (pathname.startsWith("/api/")) {
    // Allow public API routes
    if (PUBLIC_API_ROUTES.some((route) => pathname.startsWith(route))) {
      return NextResponse.next();
    }

    // Check for server-to-server cron secret for admin routes
    if (ADMIN_API_ROUTES.some((route) => pathname.startsWith(route))) {
      const authHeader = request.headers.get("authorization");
      if (authHeader === `Bearer ${process.env.CRON_SECRET}`) {
        return NextResponse.next();
      }
    }

    // For all other API routes, validate the Bearer token
    const authHeader = request.headers.get("authorization");
    const token = authHeader?.startsWith("Bearer ")
      ? authHeader.substring(7)
      : null;

    if (!token || !(await validateToken(token))) {
      return NextResponse.json(
        { error: "A valid Bearer token is required." },
        { status: 401 }
      );
    }
  }

  // Allow all non-API routes to pass through
  return NextResponse.next();
}

export const config = {
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     */
    "/((?!_next/static|_next/image|favicon.ico).*)",
  ],
};
