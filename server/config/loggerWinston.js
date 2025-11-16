
import winston from 'winston';

const { 
    timestamp, errors, splat, 
    json, colorize, simple, combine
} = winston.format;

const logFormat = combine(
    timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    errors({ stack: true }),
    splat(),
    json()
)
// Transports config (where logs are sent)
const transports = [
    // Log/Console the transport development readability
    new winston.transports.Console({
        format: combine(
            colorize(),
            simple()
            
        )
    })
]

// Loger Instance
const logger = winston.createLogger({
    level: 'info',
    levels: winston.config.npm.levels,
    format: logFormat,
    transports
})


export default logger;
