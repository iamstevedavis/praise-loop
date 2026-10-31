export type NotificationTarget = { businessId: number };

// Expo Router accepts this shape for /queue; the id is always a string in a URL.
export type QueueHref = { pathname: "/queue"; params: { businessId: string } };

// A business id is a positive, safe integer. Reject anything else before it can
// reach the router or an API path.
export function parseBusinessId(value: unknown): number | null {
  const text = typeof value === "number" ? String(value) : typeof value === "string" ? value.trim() : "";
  if (!/^\d+$/.test(text)) return null;
  const id = Number(text);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

function decode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function queryTarget(query: string): NotificationTarget | null {
  const hash = query.indexOf("#");
  const clean = hash >= 0 ? query.slice(0, hash) : query;
  for (const part of clean.split("&")) {
    if (!part) continue;
    const equals = part.indexOf("=");
    const key = decode(equals >= 0 ? part.slice(0, equals) : part);
    if (key !== "businessId") continue;
    const id = parseBusinessId(decode(equals >= 0 ? part.slice(equals + 1) : ""));
    if (id) return { businessId: id };
  }
  return null;
}

// Only our own scheme and queue route are accepted, e.g.
// praiseloop://queue?businessId=3. The worker puts this URL in the notification
// data alongside the numeric businessId.
export function parseDeepLink(value: unknown): NotificationTarget | null {
  if (typeof value !== "string") return null;
  const match = /^praiseloop:\/\/(.*)$/i.exec(value.trim());
  if (!match) return null;
  const body = match[1];
  const queryAt = body.indexOf("?");
  const path = (queryAt >= 0 ? body.slice(0, queryAt) : body).replace(/^\/+|\/+$/g, "");
  if (path !== "queue") return null;
  return queryTarget(queryAt >= 0 ? body.slice(queryAt + 1) : "");
}

export function parseNotificationData(data: unknown): NotificationTarget | null {
  if (!data || typeof data !== "object") return null;
  const record = data as Record<string, unknown>;
  const fromUrl = parseDeepLink(record.url);
  if (fromUrl) return fromUrl;
  const id = parseBusinessId(record.businessId);
  return id ? { businessId: id } : null;
}

export function notificationTargetFromResponse(response: unknown): NotificationTarget | null {
  const data = (response as { notification?: { request?: { content?: { data?: unknown } } } } | null)
    ?.notification?.request?.content?.data;
  return parseNotificationData(data);
}

export function queueHref(target: NotificationTarget): QueueHref {
  return { pathname: "/queue", params: { businessId: String(target.businessId) } };
}

export type NotificationRoute =
  | { kind: "ignore" }
  | { kind: "hold"; target: NotificationTarget }
  | { kind: "navigate"; href: QueueHref };

// A tap before sign-in is remembered; the router navigates once the session is
// ready. With a session it goes straight to the target queue.
export function planNotificationRoute(target: NotificationTarget | null, signedIn: boolean): NotificationRoute {
  if (!target) return { kind: "ignore" };
  return signedIn ? { kind: "navigate", href: queueHref(target) } : { kind: "hold", target };
}
