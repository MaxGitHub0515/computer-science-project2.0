
import morgan from "morgan";
import type { StreamOptions } from "morgan";
import logger from "../config/loggerWinston"

// Stream for writting morgan logs using winston
const stream: StreamOptions = {
    write: (message:string) => logger.http(message.trim())
};

// Skipping logging in certain environments
const skip = () => {
    const env = process.env.NODE_ENV || 'development';
    return env === 'test'
}

// Morgan Middleware setup
const morganMiddleware = morgan(
    // Custom format string to match typical log structure
    'combined',
    { stream, skip }
);
export default morganMiddleware;
