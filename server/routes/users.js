import express from 'express';
import { getPool, sql } from '../db.js';
import { requireAuth } from '../middleware/authMiddleware.js';

const router = express.Router();

// Get current user with organization info
router.get('/me', requireAuth, async (req, res) => {
    try {
        const user = { ...req.user };
        
        // Attach org info if user has an orgId
        if (user.orgId) {
            const pool = await getPool();
            const orgResult = await pool.request()
                .input('orgId', sql.Int, user.orgId)
                .query('SELECT id, name, slug FROM Organizations WHERE id = @orgId');
            
            if (orgResult.recordset.length > 0) {
                user.organization = orgResult.recordset[0];
            }
        }
        
        res.json(user);
    } catch (err) {
        // Fallback: return user without org info
        res.json(req.user);
    }
});

export default router;