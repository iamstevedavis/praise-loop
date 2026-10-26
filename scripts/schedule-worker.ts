// The old due-time stub sweep could falsely mark posts scheduled and logged content.
// Retired until #29's durable, owner-authorized provider implementation is verified.
console.error("Scheduling unavailable: no verified Buffer connection. See docs/integrations.md; no posts submitted or statuses changed.");
process.exitCode=1;
