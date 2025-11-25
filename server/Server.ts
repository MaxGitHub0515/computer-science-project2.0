
import express from "express";
import dotenv from 'dotenv';
// Routers imports
import gamesRoutes from './routes/games.routes';
// Middleware imports 
import morganMiddleware from './middleware/morganMiddleware';
import corsMiddleware from './middleware/corsMiddleware';
import logger from './config/loggerWinston';

const app = express();
dotenv.config({ path: '.env.local' });

// Built-in middleware 
app.use(express.json()); // to parse JSON bodies

// Middlewares
app.use(morganMiddleware);
app.use(corsMiddleware())

// Endpoints
app.use('api/v1/games', gamesRoutes);

// Local Server only - not for production
const LOCAL_PORT = process.env.PORT ? parseInt(process.env.PORT) : 8001;

(function LaunchNodeServer() {
    app.listen(LOCAL_PORT, () => {
        logger.info(`Server running on http://localhost:${LOCAL_PORT}`);
   });
})();