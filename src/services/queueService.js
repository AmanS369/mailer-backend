const { Queue } = require('bullmq');
const { getRedisConnectionOptions } = require('../config/redis');

let emailQueue = null;

function getEmailQueue() {
  if (!emailQueue) {
    const connectionOptions = getRedisConnectionOptions();
    emailQueue = new Queue('outreach-emails', {
      connection: connectionOptions,
      defaultJobOptions: {
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 5000,
        },
        removeOnComplete: 1000,
        removeOnFail: 2000,
      },
    });
  }
  return emailQueue;
}

/**
 * Enqueue a scheduled email (FIRST_TOUCH or FOLLOW_UP)
 * @param {string} emailId
 * @param {'FIRST_TOUCH'|'FOLLOW_UP'} type
 * @param {Date|number} scheduledFor
 */
async function scheduleEmailJob(emailId, type, scheduledFor) {
  const queue = getEmailQueue();
  const now = Date.now();
  const targetTime = new Date(scheduledFor).getTime();
  const delay = Math.max(0, targetTime - now);

  const jobId = `${type.toLowerCase()}-${emailId}`;

  // Remove existing job with same ID if any
  try {
    const existingJob = await queue.getJob(jobId);
    if (existingJob) {
      await existingJob.remove();
    }
  } catch (err) {
    // Ignore if job doesn't exist
  }

  const job = await queue.add(
    type,
    { emailId, type },
    {
      jobId,
      delay,
    }
  );

  return job;
}

/**
 * Cancel a scheduled email job
 * @param {string} emailId
 * @param {'FIRST_TOUCH'|'FOLLOW_UP'} type
 */
async function cancelEmailJob(emailId, type) {
  const queue = getEmailQueue();
  const jobId = `${type.toLowerCase()}-${emailId}`;
  try {
    const job = await queue.getJob(jobId);
    if (job) {
      await job.remove();
    }
  } catch (err) {
    console.warn(`[Queue] Failed to remove job ${jobId}:`, err.message);
  }
}

module.exports = {
  getEmailQueue,
  scheduleEmailJob,
  cancelEmailJob,
};

