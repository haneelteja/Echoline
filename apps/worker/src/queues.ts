import { Queue } from "bullmq";
import { getRedisConnection } from "./redis.js";

export const SCHEDULER_QUEUE = "scheduler";
export const SEND_EMAIL_QUEUE = "send-email";
export const SEND_WHATSAPP_QUEUE = "send-whatsapp";

export interface SendJobData {
  orgId: string;
  projectId: string;
  contactId: string;
  step: number;
}

let schedulerQueue: Queue | null = null;
let sendEmailQueue: Queue<SendJobData> | null = null;
let sendWhatsAppQueue: Queue<SendJobData> | null = null;

export function getSchedulerQueue(): Queue {
  schedulerQueue ??= new Queue(SCHEDULER_QUEUE, { connection: getRedisConnection() });
  return schedulerQueue;
}

export function getSendEmailQueue(): Queue<SendJobData> {
  sendEmailQueue ??= new Queue<SendJobData>(SEND_EMAIL_QUEUE, { connection: getRedisConnection() });
  return sendEmailQueue;
}

export function getSendWhatsAppQueue(): Queue<SendJobData> {
  sendWhatsAppQueue ??= new Queue<SendJobData>(SEND_WHATSAPP_QUEUE, { connection: getRedisConnection() });
  return sendWhatsAppQueue;
}
