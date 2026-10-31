import type { ApiClient } from "./client";
import { DELETE_ACCOUNT_CONFIRMATION } from "../profile/accountDeletion";

// The server deletes the calling session in the same transaction, so there is
// nothing to revoke afterwards. A 401 means it is already gone; the shared
// client maps it to signedOut and the profile screen signs out normally.
export async function deleteAccount(client: ApiClient): Promise<void> {
  await client.request<{ ok?: unknown }>("/api/account", {
    method: "DELETE",
    body: { confirm: DELETE_ACCOUNT_CONFIRMATION }
  });
}
