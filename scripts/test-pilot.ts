import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { pilotReport, PilotBusiness, PilotEvent } from "../lib/pilot";

const start = "2026-10-01T00:00:00.000Z", end = "2026-10-15T00:00:00.000Z";
const events: PilotEvent[] = [
  { type: "onboarding_start", at: start },
  { type: "draft_complete", at: "2026-10-01T00:04:00.000Z" },
  { type: "session_start", at: "2026-10-02T10:00:00.000Z", id: "s1" },
  { type: "session_end", at: "2026-10-02T10:14:00.000Z", id: "s1" },
  { type: "session_start", at: "2026-10-09T10:00:00.000Z", id: "s2" },
  { type: "approved", at: "2026-10-02T10:02:00.000Z", id: "d1", unedited: true },
  { type: "approved", at: "2026-10-02T10:03:00.000Z", id: "d2", unedited: false },
  { type: "scheduled", at: "2026-10-02T10:04:00.000Z", id: "d1" },
  { type: "published", at: "2026-10-09T10:04:00.000Z", id: "d1" },
  { type: "returned", at: "2026-10-08T00:00:00.000Z" },
  { type: "generation_cost", at: start, id: "c1", usd: 0.1 },
  { type: "generation_cost", at: start, id: "c2", usd: 0.2 },
  { type: "approved", at: end, id: "excluded" }
];
const business: PilotBusiness = { id: "pilot-a", synthetic: false, events };
const report = (rows = [business], finish = end) => pilotReport(rows, ["pilot-a"], start, finish)[0];
const result = report();
assert.equal(result.firstDraftMinutes, 4);
assert.deepEqual([result.approved, result.approvalEditStatusKnown, result.approvedWithoutEdits, result.approvedWithoutEditsRate], [2, 2, 1, 0.5]);
assert.deepEqual(result.sessions.map(s => s.minutes), [14, null]);
assert.deepEqual([result.scheduled, result.published, result.returnedInWeekTwo, result.generationCostUsd], [1, 1, true, 0.3]);
assert.deepEqual(report([{ ...business, events: [...events].reverse() }]), result);
assert.equal(pilotReport([{ ...business, synthetic: true }], ["pilot-a"], start, end).length, 0);
assert.equal(pilotReport([business, { ...business, id: "other-owner" }], ["pilot-a"], start, end).length, 1);
assert.throws(() => pilotReport([business], ["foreign"], start, end));
assert.throws(() => pilotReport([business], [], start, end));
assert.throws(() => pilotReport([business, business], ["pilot-a"], start, end));
assert.throws(() => report([business], start));
assert.throws(() => report([business], "2026-02-30T00:00:00.000Z"));
assert.throws(() => report([{ ...business, events: [...events, events[5]] }]));
assert.throws(() => report([{ ...business, events: [{ type: "generation_cost", at: start, id: "x", usd: -1 }] }]));
assert.throws(() => report([{ ...business, events: [{ type: "session_start", at: start }] }]));
const empty = report([{ ...business, events: [] }]);
assert.deepEqual([empty.firstDraftMinutes, empty.approvedWithoutEditsRate, empty.generationCostUsd, empty.returnedInWeekTwo], [null, null, null, null]);
assert.equal(empty.approved, 0);
const withoutReturn = { ...business, events: events.filter(e => e.type !== "returned") };
assert.equal(report([withoutReturn]).returnedInWeekTwo, false);
assert.equal(report([withoutReturn], "2026-10-08T00:00:00.000Z").returnedInWeekTwo, null);
const atWindowEnd = { ...withoutReturn, events: [...withoutReturn.events, { type: "returned" as const, at: end }] };
assert.equal(report([atWindowEnd]).returnedInWeekTwo, false);
const beforeWeekTwo = { ...withoutReturn, events: [...withoutReturn.events, { type: "returned" as const, at: "2026-10-07T23:59:59.999Z" }] };
assert.equal(report([beforeWeekTwo]).returnedInWeekTwo, false);
assert.equal(report([{ ...business, events: [{ type: "generation_cost", at: start, id: "zero", usd: 0 }] }]).generationCostUsd, 0);
assert.equal(report([{ ...business, events: [{ type: "generation_cost", at: start, id: "tiny", usd: 0.0000001 }] }]).generationCostUsd, 0.0000001);
assert.equal(pilotReport([business], ["pilot-a"], "2026-10-02T00:00:00.000Z", end)[0].firstDraftMinutes, null);
assert.equal(report([{ ...business, events: events.filter(e => e.type !== "draft_complete") }]).firstDraftMinutes, null);
assert.equal(report([{ ...business, events: events.map(e => e.type === "approved" ? { ...e, unedited: undefined } : e) }]).approvedWithoutEditsRate, null);
const orphan = report([{ ...business, events: [events[3], events[2]].map(e => e.type === "session_end" ? { ...e, at: start } : e) }]);
assert.equal(orphan.unmatchedSessionEnds, 1);
assert.equal(orphan.sessions[0].minutes, null);
const textBearing = { ...business, review_text: "private", tokens: "private", events: events.map(e => ({ ...e, caption: "private" })) };
assert.doesNotMatch(JSON.stringify(report([textBearing])), /private|caption|tokens|review_text/);
const example = JSON.parse(readFileSync("sample-data/pilot/pilot-synthetic.json", "utf8")) as PilotBusiness[];
assert.deepEqual(pilotReport(example, ["synthetic-demo"], start, end), []);
const demonstration = pilotReport(example.map(b => ({ ...b, synthetic: false })), ["synthetic-demo"], start, end)[0];
assert.deepEqual([demonstration.firstDraftMinutes, demonstration.sessions[0].minutes, demonstration.approvedWithoutEditsRate], [4, 12, 1]);
console.log("pilot metric tests passed (synthetic fixtures only)");

// A repeated transition/receipt cannot become new merely by crossing a report boundary.
for (const type of ["approved", "scheduled", "published", "session_start", "session_end", "generation_cost"] as const) {
  for (const outside of ["2026-09-30T23:59:59.999Z", end]) {
    const repeated: PilotEvent = { type, at: start, id: "repeated", usd: 0.1 };
    assert.throws(() => report([{ ...business, events: [repeated, { ...repeated, at: outside }] }]), /Duplicate observation/);
  }
}
