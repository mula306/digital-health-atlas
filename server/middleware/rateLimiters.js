import rateLimit, { ipKeyGenerator } from 'express-rate-limit';

const getClientKey = (req) => {
    const ipPart = ipKeyGenerator(req.ip || req.socket?.remoteAddress || '');
    const userOid = req.user?.oid;
    return userOid ? `${userOid}:${ipPart}` : ipPart;
};

const createLimiter = ({ windowMs, max, message }) => rateLimit({
    windowMs,
    max,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: getClientKey,
    handler: (req, res) => {
        const retryAfterSeconds = Math.ceil(windowMs / 1000);
        res.status(429).json({
            error: message,
            retryAfterSeconds
        });
    }
});

export const intakeSubmissionCreateLimiter = createLimiter({
    windowMs: 10 * 60 * 1000,
    max: 25,
    message: 'Too many intake submissions. Please try again shortly.'
});

export const governanceRoutingLimiter = createLimiter({
    windowMs: 10 * 60 * 1000,
    max: 40,
    message: 'Too many governance routing actions. Please slow down.'
});

export const governanceVoteLimiter = createLimiter({
    windowMs: 5 * 60 * 1000,
    max: 20,
    message: 'Too many governance vote attempts. Please wait and retry.'
});

export const governanceDecisionLimiter = createLimiter({
    windowMs: 10 * 60 * 1000,
    max: 10,
    message: 'Too many governance decision attempts. Please wait and retry.'
});

export const intakeConversationLimiter = createLimiter({
    windowMs: 5 * 60 * 1000,
    max: 40,
    message: 'Too many intake conversation messages. Please slow down.'
});

export const governanceConfigWriteLimiter = createLimiter({
    windowMs: 10 * 60 * 1000,
    max: 50,
    message: 'Too many governance configuration changes. Please wait and retry.'
});
