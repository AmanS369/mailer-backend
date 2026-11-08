const mongoose = require('mongoose');
const config = require('./env');

let isConnected = false;

async function connectDB() {
  if (isConnected) return;
  try {
    const conn = await mongoose.connect(config.MONGODB_URI, {
      autoIndex: true,
    });
    isConnected = true;
    console.log(`[MongoDB] Connected: ${conn.connection.host}`);
  } catch (error) {
    console.error('[MongoDB] Connection error:', error.message);
    throw error;
  }
}

module.exports = {
  connectDB,
  mongoose,
};

