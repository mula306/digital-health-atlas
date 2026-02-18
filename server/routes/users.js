import express from 'express';
import { getPool, sql } from '../db.js';
import { requireAuth } from '../middleware/authMiddleware.js';
import { handleError } from '../utils/errorHandler.js';

const router = express.Router();

// Get current user
router.get('/me', requireAuth, (req, res) => {
    // req.user is populated by the passport-jwt strategy in index.js
    // It already contains the DB user record
    res.json(req.user);
});

export default router;
