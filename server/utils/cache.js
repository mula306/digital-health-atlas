import NodeCache from 'node-cache';

// Initialize shared cache with 60 second TTL
// Standard TTL is 60s, checkperiod 120s
export const cache = new NodeCache({ stdTTL: 60, checkperiod: 120 });

export const CACHE_KEYS = {
    TAG_GROUPS: 'tagGroups',
    PERMISSIONS: 'all_role_permissions',
    PROJECT_PREFIX: 'projects_'
};

/**
 * Invalidate all project listings
 */
export const invalidateProjectCache = () => {
    const keys = cache.keys().filter(k => k.startsWith(CACHE_KEYS.PROJECT_PREFIX));
    if (keys.length > 0) {
        cache.del(keys);
        console.log(`Invalidated ${keys.length} project cache keys`);
    }
};

/**
 * Invalidate tag groups
 */
export const invalidateTagCache = () => {
    cache.del(CACHE_KEYS.TAG_GROUPS);
    console.log('Invalidated tag cache');
};
