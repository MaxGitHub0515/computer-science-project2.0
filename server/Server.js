
import express from 'express';
import dotenv from 'dotenv';
// Routers imports
import wikiRouter from './routes/test-router.js';
// Middleware imports 
import morganMiddleware from './middleware/morganMiddleware.js';
import corsMiddleware from './middleware/corsMiddleware.js';
import logger from './config/loggerWinston.js';

const app = express();
dotenv.config({ path: '.env.local' });

// Built-in middleware 
app.use(express.json()); // to parse JSON bodies

// Middlewares
app.use(morganMiddleware);
app.use(corsMiddleware())

// Endpoints
app.use('/wiki', wikiRouter);

// Local Server only - not for production
const LocalSPort = process.env.PORT || 8001;
 
(function LaunchNodeServer() {
    app.listen(LocalSPort, () => {
        logger.info(`Server running on http://localhost:${LocalSPort}`);
   });
})();