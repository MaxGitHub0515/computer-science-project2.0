
import winston from 'winston';

type Logger = ReturnType<typeof winston.createLogger>;
type LoggerOptions = Parameters<typeof winston.createLogger>[0];

const format = winston.format;

const logFormat = format.combine(
    format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    format.errors({ stack: true }),
    format.splat(),
    format.json()
)

// Transports config (where logs are sent)
const transports = [
    // Log/Console the transport development readability
    new winston.transports.Console({
        format: format.combine(
            format.colorize(),
            format.simple()
        )
    })
];


// Loger Instance
const loggerOptions: LoggerOptions = {
    level: process.env.LOG_LEVEL || 'info',
    levels: winston.config.npm.levels,
    format: logFormat,
    transports
}
// logger instance 
const logger: Logger = winston.createLogger(loggerOptions);

export default logger;
