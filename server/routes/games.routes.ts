
import express, { Router } from "express";

const router: Router = express.Router();

// Landing (Create | Join)
router.get('/');

// Create a new game lobby and registers the first player
router.post('/:alias')

// Join an existing game lobby.
router.post('/:code/join')

// Return confirmation that the game has begun.
router.post('/:code/start')

// Receive a new text/image submission from a player
router.post('/:alias/rounds/:n/submissions')

// Vote for a specific submission
router.post('/vote/:submissionId')

export default router;