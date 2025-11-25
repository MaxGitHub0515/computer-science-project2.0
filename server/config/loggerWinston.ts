
import winston, {transports as WinstonTransports} from 'winston';
import  type { 
    Logger, 
    LoggerOptions, 
} from 'winston';

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
const transports: WinstonTransports.ConsoleTransportInstance[] = [
    // Log/Console the transport development readability
    new WinstonTransports.Console({
        format: combine(
            colorize(),
            simple()
            
        )
    })
]


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
