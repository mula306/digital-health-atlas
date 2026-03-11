const testApiPort = Number.parseInt(process.env.PLAYWRIGHT_API_PORT || '3101', 10);

export const TEST_FIXTURE_IDS = Object.freeze({
    GOAL_1: 9101,
    PROJECT_1: 9301,
    ORG_2: 2
});

export const setMockPersona = async (page, persona) => {
    await page.addInitScript(({ nextPersona }) => {
        window.__DHA_TEST_USER__ = nextPersona;
        window.localStorage.setItem('dha_test_user', nextPersona);
        window.sessionStorage.setItem('dha_test_user', nextPersona);
    }, { nextPersona: persona });
};

export const apiUrl = (path) => new URL(path, `http://localhost:${testApiPort}`).toString();

export const apiHeaders = (persona, headers = {}) => ({
    'x-test-user': persona,
    ...headers
});
