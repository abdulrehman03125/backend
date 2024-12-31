const winston = require('winston');
const { format } = winston;

// Custom format for payment-related logs
const paymentFormat = format.printf(({ level, message, timestamp, ...metadata }) => {
  let msg = `${timestamp} [${level}]: ${message}`;
  
  if (metadata.paymentId) {
    msg += ` [Payment ID: ${metadata.paymentId}]`;
  }
  
  if (metadata.error) {
    msg += `\nError: ${JSON.stringify(metadata.error)}`;
  }
  
  if (Object.keys(metadata).length > 0) {
    msg += `\nMetadata: ${JSON.stringify(metadata)}`;
  }
  
  return msg;
});

// Create the logger
const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: format.combine(
    format.timestamp(),
    format.errors({ stack: true }),
    format.metadata(),
    paymentFormat
  ),
  defaultMeta: { service: 'payment-service' },
  transports: [
    // Write all logs error (and below) to error.log
    new winston.transports.File({
      filename: 'logs/error.log',
      level: 'error',
      maxsize: 5242880, // 5MB
      maxFiles: 5,
    }),
    // Write all logs to combined.log
    new winston.transports.File({
      filename: 'logs/combined.log',
      maxsize: 5242880, // 5MB
      maxFiles: 5,
    }),
  ],
});

// If we're not in production, log to the console with colors
if (process.env.NODE_ENV !== 'production') {
  logger.add(new winston.transports.Console({
    format: format.combine(
      format.colorize(),
      format.simple()
    ),
  }));
}

// Create a stream object for Morgan HTTP logger
logger.stream = {
  write: (message) => logger.info(message.trim()),
};

module.exports = logger;
