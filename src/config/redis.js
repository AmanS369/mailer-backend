const Redis = require('ioredis');
const { URL } = require('url');
const config = require('./env');

function getRedisConnectionOptions() {
  const options = {
    maxRetriesPerRequest: null, // Required by BullMQ
    enableReadyCheck: false,
    retryStrategy(times) {
      return Math.min(times * 100, 3000);
    },
  };

  try {
    const parsed = new URL(config.REDIS_URL);
    options.host = parsed.hostname || '127.0.0.1';
    options.port = parseInt(parsed.port, 10) || 6379;
    if (parsed.password) {
      options.password = decodeURIComponent(parsed.password);
    }
  } catch (err) {
    options.host = '127.0.0.1';
    options.port = 6379;
  }

  if (config.REDIS_PASSWORD) {
    options.password = config.REDIS_PASSWORD;
  }

  return options;
}

let redisClient = null;

function getRedisClient() {
  if (!redisClient) {
    const options = getRedisConnectionOptions();
    redisClient = new Redis(config.REDIS_URL, options);
    redisClient.on('error', (err) => {
      console.error('[Redis] Connection error:', err.message);
    });
    redisClient.on('connect', () => {
      console.log('[Redis] Connected successfully');
    });
  }
  return redisClient;
}

/**
 * Acquire a distributed lock using Redis SET NX PX
 * @param {string} lockKey
 * @param {number} ttlMs
 * @returns {Promise<boolean>}
 */
async function acquireLock(lockKey, ttlMs = 60000) {
  try {
    const client = getRedisClient();
    const result = await client.set(`lock:${lockKey}`, 'locked', 'PX', ttlMs, 'NX');
    return result === 'OK';
  } catch (err) {
    console.error(`[Lock] Error acquiring lock for ${lockKey}:`, err.message);
    return false;
  }
}

/**
 * Release a distributed lock
 * @param {string} lockKey
 */
async function releaseLock(lockKey) {
  try {
    const client = getRedisClient();
    await client.del(`lock:${lockKey}`);
  } catch (err) {
    console.error(`[Lock] Error releasing lock for ${lockKey}:`, err.message);
  }
}

module.exports = {
  getRedisClient,
  getRedisConnectionOptions,
  acquireLock,
  releaseLock,
};

