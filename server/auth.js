import passport from 'passport';
import { Strategy as JwtStrategy, ExtractJwt } from 'passport-jwt';
import jwksRsa from 'jwks-rsa';
import 'dotenv/config';

const tenantID = process.env.AZURE_TENANT_ID;
const clientID = process.env.AZURE_CLIENT_ID;

if (!tenantID || tenantID === "common") {
    console.error("CRITICAL SECURITY ERROR: AZURE_TENANT_ID must be set to a specific tenant ID, not 'common'.");
    process.exit(1);
}

if (!clientID) {
    console.error("CRITICAL SECURITY ERROR: AZURE_CLIENT_ID must be set.");
    process.exit(1);
}

const jwksUri = `https://login.microsoftonline.com/${tenantID}/discovery/v2.0/keys`;

const opts = {
    jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
    secretOrKeyProvider: jwksRsa.passportJwtSecret({
        cache: true,
        rateLimit: true,
        jwksRequestsPerMinute: 5,
        jwksUri: jwksUri
    }),
    // Accept both v1 and v2 issuers
    issuer: [
        `https://login.microsoftonline.com/${tenantID}/v2.0`, // v2.0
        `https://sts.windows.net/${tenantID}/`              // v1.0
    ],
    algorithms: ['RS256'],
    // Allow both the Client ID and the API URI ID as valid audiences
    audience: [clientID, `api://${clientID}`]
};

passport.use(new JwtStrategy(opts, (jwt_payload, done) => {
    // Determine roles from the token
    // Azure AD tokens usually put roles in 'roles' array
    const user = {
        oid: jwt_payload.oid,
        tid: jwt_payload.tid,
        name: jwt_payload.name || jwt_payload.preferred_username,
        // Map roles to array, default to empty
        roles: jwt_payload.roles || []
    };

    return done(null, user);
}));

export default passport;
