const { Worker } = require('bullmq');
const { getRedisConnectionOptions } = require('../config/redis');
const emailService = require('../services/emailService');
const ScheduledJob = require('../models/ScheduledJob');

let worker = null;

function startEmailWorker() {
  if (worker) return worker;

  const connectionOptions = getRedisConnectionOptions();
  worker = new Worker(
    'outreach-emails',
    async (job) => {
      const { emailId, type } = job.data;
      console.log(`[Worker] Processing job ${job.id} (${type}) for email ${emailId}`);

      await ScheduledJob.findOneAndUpdate(
        { emailId, type },
        { status: 'ACTIVE' }
      );

      if (type === 'FIRST_TOUCH') {
        return await emailService.executeSendInitial(emailId);
      } else if (type === 'FOLLOW_UP') {
        return await emailService.executeFollowUp(emailId);
      } else {
        throw new Error(`Unknown job type: ${type}`);
      }
    },
    {
      connection: connectionOptions,
      concurrency: 2, // Conservative concurrency to avoid Gmail rate limits
    }
  );

  worker.on('completed', async (job) => {
    console.log(`[Worker] Job ${job.id} (${job.name}) completed successfully.`);
    const { emailId, type } = job.data;
    await ScheduledJob.findOneAndUpdate(
      { emailId, type },
      { status: 'COMPLETED' }
    );
  });

  worker.on('failed', async (job, err) => {
    console.error(`[Worker] Job ${job?.id} failed:`, err.message);
    if (job?.data) {
      const { emailId, type } = job.data;
      await ScheduledJob.findOneAndUpdate(
        { emailId, type },
        { status: 'FAILED', error: err.message }
      );
    }
  });

  console.log('[Worker] Email worker started inside backend process.');
  return worker;
}

module.exports = {
  startEmailWorker,
};

