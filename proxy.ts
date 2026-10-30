import { NextResponse } from "next/server";
// Never expose legacy public/generated assets outside the owner-authorized media route.
// Next 16 renamed the `middleware` file convention to `proxy`.
export function proxy() { return new NextResponse(null, { status: 404 }); }
export const config = { matcher: ["/generated/:path*"] };
