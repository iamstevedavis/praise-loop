export type SchedulePayload = {
  draftPostId: number; businessId: number; quoteText: string;
  captionText: string; imagePath: string | null; scheduledFor: string;
};
export type ScheduleReceipt = { provider: "buffer" | "fake"; confirmed: boolean; externalId?: string; status: "scheduled" | "simulated" };
export interface SchedulerAdapter { schedulePost(payload: SchedulePayload): Promise<ScheduleReceipt>; }
export class SchedulerUnavailable extends Error {
  constructor() { super("Buffer integration is not configured/verified; see docs/integrations.md. No post was submitted."); }
}
// Explicit local/test fake. Never returns a real scheduled/published receipt or logs content.
export class StubSchedulerAdapter implements SchedulerAdapter {
  async schedulePost(payload: SchedulePayload): Promise<ScheduleReceipt> {
    return { provider:"fake",confirmed:false,status:"simulated",externalId:`fake-${payload.draftPostId}` };
  }
}
export function getSchedulerAdapter(): SchedulerAdapter { throw new SchedulerUnavailable(); }
export async function scheduleApprovedDraft(payload: SchedulePayload): Promise<ScheduleReceipt> {
  return getSchedulerAdapter().schedulePost(payload);
}
