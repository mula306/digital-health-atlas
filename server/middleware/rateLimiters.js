import rateLimit, { ipKeyGenerator } from 'express-rate-limit';

const parsePositiveInt = (value, fallback) => {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const limiterConfig = {
    intakeSubmissionWindowMs: parsePositiveInt(process.env.RL_INTAKE_SUBMISSION_WINDOW_MS, 10 * 60 * 1000),
    intakeSubmissionMax: parsePositiveInt(process.env.RL_INTAKE_SUBMISSION_MAX, 50),
    governanceRoutingWindowMs: parsePositiveInt(process.env.RL_GOVERNANCE_ROUTING_WINDOW_MS, 10 * 60 * 1000),
    governanceRoutingMax: parsePositiveInt(process.env.RL_GOVERNANCE_ROUTING_MAX, 80),
    governanceVoteWindowMs: parsePositiveInt(process.env.RL_GOVERNANCE_VOTE_WINDOW_MS, 5 * 60 * 1000),
    governanceVoteMax: parsePositiveInt(process.env.RL_GOVERNANCE_VOTE_MAX, 40),
    governanceDecisionWindowMs: parsePositiveInt(process.env.RL_GOVERNANCE_DECISION_WINDOW_MS, 10 * 60 * 1000),
    governanceDecisionMax: parsePositiveInt(process.env.RL_GOVERNANCE_DECISION_MAX, 20),
    intakeConversationWindowMs: parsePositiveInt(process.env.RL_INTAKE_CONVERSATION_WINDOW_MS, 5 * 60 * 1000),
    intakeConversationMax: parsePositiveInt(process.env.RL_INTAKE_CONVERSATION_MAX, 80),
    governanceConfigWriteWindowMs: parsePositiveInt(process.env.RL_GOVERNANCE_CONFIG_WINDOW_MS, 10 * 60 * 1000),
    governanceConfigWriteMax: parsePositiveInt(process.env.RL_GOVERNANCE_CONFIG_MAX, 100)
};

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
    windowMs: limiterConfig.intakeSubmissionWindowMs,
    max: limiterConfig.intakeSubmissionMax,
    message: 'Too many intake submissions. Please try again shortly.'
});

export const governanceRoutingLimiter = createLimiter({
    windowMs: limiterConfig.governanceRoutingWindowMs,
    max: limiterConfig.governanceRoutingMax,
    message: 'Too many governance routing actions. Please slow down.'
});

export const governanceVoteLimiter = createLimiter({
    windowMs: limiterConfig.governanceVoteWindowMs,
    max: limiterConfig.governanceVoteMax,
    message: 'Too many governance vote attempts. Please wait and retry.'
});

export const governanceDecisionLimiter = createLimiter({
    windowMs: limiterConfig.governanceDecisionWindowMs,
    max: limiterConfig.governanceDecisionMax,
    message: 'Too many governance decision attempts. Please wait and retry.'
});

export const intakeConversationLimiter = createLimiter({
    windowMs: limiterConfig.intakeConversationWindowMs,
    max: limiterConfig.intakeConversationMax,
    message: 'Too many intake conversation messages. Please slow down.'
});

export const governanceConfigWriteLimiter = createLimiter({
    windowMs: limiterConfig.governanceConfigWriteWindowMs,
    max: limiterConfig.governanceConfigWriteMax,
    message: 'Too many governance configuration changes. Please wait and retry.'
});
