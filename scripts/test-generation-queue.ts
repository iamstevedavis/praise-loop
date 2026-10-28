import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { setTimeout } from "node:timers/promises";
import { Queue, Worker } from "bullmq";
import { databaseFixture } from "./db-fixture";
import { generationTick, redisConnection } from "../lib/services/generationQueue";
import { processGeneration } from "../lib/services/generation";
async function main() {
  if (!process.env.TEST_REDIS_URL) { console.log("Redis delivery fixture skipped: set TEST_REDIS_URL"); return; }
  process.env.REDIS_URL=process.env.TEST_REDIS_URL;
  await databaseFixture(async client=>{
    await client.query("INSERT INTO auth_users(id,email) VALUES('queue-owner','queue@example.invalid')");
    await client.query("INSERT INTO owner_plans(owner_id,plan,source) VALUES('queue-owner','pro','manual')");
    const bid=(await client.query("INSERT INTO businesses(name,timezone,owner_id) VALUES('Synthetic queue','UTC','queue-owner') RETURNING id")).rows[0].id;
    await client.query("INSERT INTO reviews(business_id,source,source_review_id,rating,text,reviewed_at) SELECT $1,'manual',n::text,5,'A synthetic review with lovely welcoming staff '||n,now() FROM generate_series(1,10) n",[bid]);
    const connection=redisConnection(), name=`fixture-${randomUUID()}`, queue=new Queue(name,{connection});
    let worker: Worker | undefined, captions=0;
    try {
      await generationTick(queue); assert.equal(await queue.getWaitingCount(),3);
      await queue.drain(); // Lost delivery records must not lose the durable Postgres work.
      await generationTick(queue); assert.equal(await queue.getWaitingCount(),3);
      worker=new Worker(name,async job=>{await processGeneration(Number(job.data.id),{clock:()=>new Date(),captions:async()=>{captions++;return {friendly:"Synthetic",premium:"Synthetic",playful:"Synthetic"};},render:async()=>({publicPath:"/api/media/synthetic.png",fileSystemPath:"/tmp/synthetic.png"})});},{connection,concurrency:2});
      const deadline=Date.now()+10000;
      while(Date.now()<deadline){if((await client.query("SELECT count(*) FROM generation_jobs WHERE state='complete'")).rows[0].count==="3")break;await setTimeout(100);}
      assert.equal((await client.query("SELECT count(*) FROM generation_jobs WHERE state='complete'")).rows[0].count,"3");
      await worker.close(); worker=undefined;
      await generationTick(queue); assert.equal(await queue.getWaitingCount(),0); assert.equal(captions,3);
      console.log("real BullMQ/Redis delivery loss/recovery/worker processing tests passed");
    } finally { await worker?.close(); await queue.obliterate({force:true}); await queue.close(); }
  });
}
main().catch(err=>{console.error(err);process.exitCode=1;});
