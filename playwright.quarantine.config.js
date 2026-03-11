import baseConfig from './playwright.config.js';

export default {
    ...baseConfig,
    grep: /@quarantined/,
    grepInvert: undefined
};
