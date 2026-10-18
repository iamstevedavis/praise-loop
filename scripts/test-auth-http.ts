import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { setTimeout } from "node:timers/promises";
import { databaseFixture } from "./db-fixture";
import { sessionHash } from "../lib/auth-adapter";
async function main() {
  if (process.env.TEST_AUTH_HTTP !== "1") { console.log("Auth HTTP smoke skipped: build first, set TEST_AUTH_HTTP=1 and TEST_DATABASE_URL"); return; }
  await databaseFixture(async client => {
    const port = 3177, base = `http://localhost:${port}`;
    await client.query("INSERT INTO auth_users(id,email) VALUES('synthetic-http-owner','http@example.invalid')");
    await client.query("INSERT INTO auth_sessions VALUES($1,'synthetic-http-owner',now()+interval '1 hour')", [sessionHash("synthetic-http-session")]);
    const server = spawn(process.execPath,["node_modules/next/dist/bin/next","start","-p",String(port)], {
      env: { ...process.env, NEXTAUTH_URL: base, NEXTAUTH_SECRET: "synthetic-test-only-secret-not-a-live-key", GOOGLE_CLIENT_ID: "synthetic", GOOGLE_CLIENT_SECRET: "synthetic" }, stdio: "ignore" });
    try {
      let ready = false;
      for (let i = 0; i < 100; i++) { try { if ((await fetch(base)).ok) { ready = true; break; } } catch {} await setTimeout(100); }
      assert.ok(ready,"production server starts");
      const cookie = "next-auth.session-token=synthetic-http-session";
      assert.equal((await fetch(`${base}/api/businesses`, { headers: { cookie } })).status,200);
      assert.equal((await fetch(`${base}/generated/draft-777.png`)).status,404);
      const csrfResponse = await fetch(`${base}/api/auth/csrf`);
      const { csrfToken } = await csrfResponse.json(); assert.equal(typeof csrfToken,"string");
      const csrfCookie = csrfResponse.headers.getSetCookie().map(v=>v.split(";")[0]).join("; ");
      const signout = await fetch(`${base}/api/auth/signout`, { method:"POST", redirect:"manual", headers: { cookie: `${cookie}; ${csrfCookie}`, origin:base, "content-type":"application/x-www-form-urlencoded" }, body:new URLSearchParams({csrfToken,callbackUrl:base,json:"true"}) });
      assert.equal(signout.status,200);
      assert.equal((await fetch(`${base}/api/businesses`, { headers:{cookie} })).status,401,"retained cookie fails after actual NextAuth signout");
      assert.equal((await client.query("SELECT count(*) FROM auth_sessions")).rows[0].count,"0");
      console.log("production auth CSRF/sign-out/revocation/static-media HTTP smoke passed");
    } finally { if (server.exitCode === null) { server.kill("SIGTERM"); await new Promise<void>(resolve=>server.once("exit",()=>resolve())); } }
  });
}
main().catch(err=>{console.error(err);process.exitCode=1;});
