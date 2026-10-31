import { readdir, rm } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import { query, transaction } from "../db";
import { mediaRoot } from "./media";

export const DELETE_CONFIRMATION = "DELETE";

// Draft images and any logo stored through the media route use this shape.
// Requiring one plain filename also rejects path traversal before the disk.
const MEDIA_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*\.png$/;

export function mediaFilename(path: string | null | undefined): string | null {
  if (!path || !path.startsWith("/api/media/")) return null;
  const name = path.slice("/api/media/".length);
  return MEDIA_NAME.test(name) ? name : null;
}

function mediaPath(name: string, root = mediaRoot()): string | null {
  if (!MEDIA_NAME.test(name)) return null;
  const file = resolve(join(root, name));
  return file.startsWith(root + sep) ? file : null;
}

// Safe to retry: a missing file is fine, and one unremovable file neither stops
// the rest nor fails the request whose rows are already gone. Only a count is
// logged, never a path that could name another owner's data.
export async function removeMediaFiles(
  names: string[],
  remove: (file: string) => Promise<void> = file => rm(file, { force: true })
): Promise<void> {
  let failed = 0;
  for (const name of names) {
    const file = mediaPath(name);
    if (!file) continue;
    try {
      await remove(file);
    } catch {
      failed += 1;
    }
  }
  if (failed) console.error("account_deletion_media_cleanup_failed", { files: failed });
}

const DRAFT_IMAGE = /^draft-(\d+)(?:-[0-9a-f]+)?\.png$/;

// Files in MEDIA_ROOT named for any of these draft ids, including superseded versions.
export async function olderImageVersions(draftIds: Set<string>, root = mediaRoot()): Promise<string[]> {
  if (!draftIds.size) return [];
  try {
    return (await readdir(root)).filter(name => {
      const match = DRAFT_IMAGE.exec(name);
      return !!match && draftIds.has(match[1]);
    });
  } catch {
    return [];
  }
}

// Everything the owner owns goes in one transaction, so a failure leaves the
// account intact. Existing ON DELETE CASCADE covers reviews, drafts, events,
// jobs, periods, slot claims, push deliveries and the auth tables; only the
// owner row and explicit owner-column rows need deleting here. The media files
// are removed after the commit by the caller.
export async function deleteOwnerAccount(
  ownerId: string,
  remove: (names: string[]) => Promise<void> = removeMediaFiles
): Promise<{ mediaFiles: number }> {
  const draftIds = new Set<string>();
  const names = await transaction(async () => {
    const locked = await query("SELECT 1 FROM auth_users WHERE id=$1 FOR UPDATE", [ownerId]);
    if (!locked.rowCount) throw new Error("Owner not found");

    // Codes are keyed by address, not owner, so collect both the login address
    // and any snapshot on a linked method before the auth rows disappear.
    const addresses = (await query<{ email: string }>(
      `SELECT email FROM auth_users WHERE id=$1 AND email IS NOT NULL
       UNION
       SELECT email FROM auth_accounts WHERE owner_id=$1 AND email IS NOT NULL`,
      [ownerId]
    )).rows.map(row => row.email.trim().toLowerCase()).filter(Boolean);

    const media = new Set<string>();
    const drafts = await query<{ id: string; image_path: string | null }>(
      `SELECT d.id, d.image_path FROM draft_posts d JOIN businesses b ON b.id=d.business_id WHERE b.owner_id=$1`,
      [ownerId]
    );
    for (const row of drafts.rows) {
      draftIds.add(String(row.id));
      const name = mediaFilename(row.image_path);
      if (name) media.add(name);
    }
    const logos = await query<{ logo_url: string | null }>("SELECT logo_url FROM businesses WHERE owner_id=$1", [ownerId]);
    for (const row of logos.rows) {
      const name = mediaFilename(row.logo_url);
      if (name) media.add(name);
    }

    if (addresses.length) {
      await query("DELETE FROM email_sign_in_codes WHERE lower(email) = ANY($1::text[])", [addresses]);
    }
    // Explicit for both an owner-column row without a business and its cascade.
    await query("DELETE FROM google_connections WHERE owner_id=$1", [ownerId]);
    await query("DELETE FROM businesses WHERE owner_id=$1", [ownerId]);
    await query("DELETE FROM auth_users WHERE id=$1", [ownerId]);

    // Rendered images are content-addressed, so another owner's draft or logo can point at the same
    // file. Keep any file that is still referenced after this owner's rows are gone.
    if (media.size) {
      const paths = [...media].map(name => `/api/media/${name}`);
      const stillUsed = await query<{ path: string }>(
        `SELECT image_path AS path FROM draft_posts WHERE image_path = ANY($1::text[])
         UNION SELECT logo_url AS path FROM businesses WHERE logo_url = ANY($1::text[])`,
        [paths]
      );
      for (const row of stillUsed.rows) {
        const name = mediaFilename(row.path);
        if (name) media.delete(name);
      }
    }
    return [...media];
  });

  // Data is committed: cleanup issues are logged and can be retried, never
  // turned into an error that suggests the account still exists.
  try {
    // Re-rendering or regenerating leaves earlier digest-suffixed versions of a draft's image on
    // disk with no row pointing at them. Their names carry the draft id, which belongs to this
    // owner alone, so sweep those too.
    for (const name of await olderImageVersions(draftIds)) if (!names.includes(name)) names.push(name);
    await remove(names);
  } catch {
    console.error("account_deletion_media_cleanup_failed", { files: names.length });
  }
  return { mediaFiles: names.length };
}
