'use strict';
// @ts-check
const { test, expect } = require('@playwright/test');

// ── Helpers ───────────────────────────────────────────────────────────────────

// Inject a valid auth token so the sidebar opens without the login modal.
// The app checks localStorage key 'drillmonitor_auth' = { ts: Date.now() }.
async function gotoWithAuth(page) {
    await page.addInitScript(() => {
        localStorage.setItem('drillmonitor_auth', JSON.stringify({ ts: Date.now() }));
    });
    await page.goto('/');
    await page.waitForSelector('#wsCanvas');
    // Open the sidebar (requires auth + adds .open class)
    await page.evaluate(() => {
        document.querySelector('#sideBar').classList.add('open');
    });
}

async function openSettingsModal(page) {
    await page.locator('#workSpaceSettings').dispatchEvent('click');
    await page.waitForSelector('#settings[open]');
}

async function closeSettingsModal(page) {
    await page.click('#settings .cancelBtn');
    await page.waitForSelector('#settings', { state: 'hidden' });
}

// ── Page load ─────────────────────────────────────────────────────────────────

test.describe('Page load', () => {
    test('loads without uncaught JS errors', async ({ page }) => {
        const errors = [];
        page.on('pageerror', e => errors.push(e.message));

        await gotoWithAuth(page);
        await page.waitForTimeout(1200);

        expect(errors).toEqual([]);
    });

    test('sidebar buttons exist in DOM', async ({ page }) => {
        await gotoWithAuth(page);
        await expect(page.locator('#workSpaceSettings')).toBeAttached();
        await expect(page.locator('#addButton')).toBeAttached();
        // saveButton is hidden until there are unsaved changes — just check it exists
        await expect(page.locator('#saveButton')).toBeAttached();
    });

    test('save button becomes visible after a settings change', async ({ page }) => {
        await gotoWithAuth(page);
        await openSettingsModal(page);
        // Change cell size to trigger showSaveBtn() on OK
        await page.fill('#cellSize', '30');
        await page.click('#settings .okBtn');
        await expect(page.locator('#saveButton')).toBeVisible();
    });

    test('workspace canvas is present', async ({ page }) => {
        await gotoWithAuth(page);
        await expect(page.locator('#wsCanvas')).toBeVisible();
    });
});

// ── Settings modal ────────────────────────────────────────────────────────────

test.describe('Workspace settings modal', () => {
    test.beforeEach(async ({ page }) => {
        await gotoWithAuth(page);
    });

    test('opens when clicking the settings button', async ({ page }) => {
        await openSettingsModal(page);
        await expect(page.locator('#settings')).toBeVisible();
    });

    test('closes when clicking Отмена', async ({ page }) => {
        await openSettingsModal(page);
        await closeSettingsModal(page);
        await expect(page.locator('#settings')).not.toBeVisible();
    });

    test('timezone select is present with expected options', async ({ page }) => {
        await openSettingsModal(page);
        const tz = page.locator('#ws_timezone');
        await expect(tz).toBeVisible();

        const options = await tz.locator('option').allTextContents();
        expect(options).toContain('Локальный (браузер)');
        expect(options.some(o => o.includes('Москва'))).toBeTruthy();
        expect(options.some(o => o.includes('Екатеринбург'))).toBeTruthy();
        expect(options.some(o => o.includes('UTC'))).toBeTruthy();
    });

    test('profile select is populated', async ({ page }) => {
        await openSettingsModal(page);
        const opts = await page.locator('#wsProfile option').count();
        expect(opts).toBeGreaterThanOrEqual(1);
    });

    test('background color input is visible', async ({ page }) => {
        await openSettingsModal(page);
        await expect(page.locator('#workSpaceColor')).toBeVisible();
    });
});

// ── Timezone: save and reload persistence ─────────────────────────────────────

test.describe('Timezone persistence', () => {
    test('selected timezone is still set after save → reload', async ({ page }) => {
        await gotoWithAuth(page);

        // Pick Yekaterinburg
        await openSettingsModal(page);
        await page.selectOption('#ws_timezone', 'Asia/Yekaterinburg');
        await page.click('#settings .okBtn');
        await page.waitForSelector('#settings', { state: 'hidden' });

        // Save to DB
        await page.evaluate(() => saveSettings());
        await page.waitForTimeout(1200);

        // Reload and verify
        await page.addInitScript(() => {
            localStorage.setItem('drillmonitor_auth', JSON.stringify({ ts: Date.now() }));
        });
        await page.reload();
        await page.waitForSelector('#wsCanvas');
        await page.evaluate(() => {
            document.querySelector('#sideBar').classList.add('open');
        });
        await openSettingsModal(page);

        const value = await page.locator('#ws_timezone').inputValue();
        expect(value).toBe('Asia/Yekaterinburg');

        // Cleanup
        await page.selectOption('#ws_timezone', '');
        await page.click('#settings .okBtn');
        await page.evaluate(() => saveSettings());
        await page.waitForTimeout(800);
    });
});

// ── Add indicator modal ───────────────────────────────────────────────────────

test.describe('Add indicator modal', () => {
    test.beforeEach(async ({ page }) => {
        await gotoWithAuth(page);
        await page.locator('#addButton').dispatchEvent('click');
        await page.waitForSelector('#newItemModal[open]');
    });

    test('opens when clicking the + button', async ({ page }) => {
        await expect(page.locator('#newItemModal')).toBeVisible();
    });

    // In add mode #ni_settingsBody is hidden (user only sees type cards).
    // The param row visibility logic lives inside _applyTypeToParamSelect —
    // we test it by making the settings body visible and calling the function directly.

    test('_applyTypeToParamSelect: digitalIndicator shows param row', async ({ page }) => {
        const display = await page.evaluate(() => {
            // Expose the settings body so the row is inspectable
            document.querySelector('#ni_settingsBody').style.display = '';
            _applyTypeToParamSelect('digitalIndicator');
            return document.querySelector('#ni_paramRow').style.display;
        });
        // empty string means default/visible (not 'none')
        expect(display).not.toBe('none');
    });

    test('_applyTypeToParamSelect: timeIndicator hides param row', async ({ page }) => {
        const display = await page.evaluate(() => {
            document.querySelector('#ni_settingsBody').style.display = '';
            _applyTypeToParamSelect('timeIndicator');
            return document.querySelector('#ni_paramRow').style.display;
        });
        expect(display).toBe('none');
    });

    test('_applyTypeToParamSelect: dateIndicator hides param row', async ({ page }) => {
        const display = await page.evaluate(() => {
            document.querySelector('#ni_settingsBody').style.display = '';
            _applyTypeToParamSelect('dateIndicator');
            return document.querySelector('#ni_paramRow').style.display;
        });
        expect(display).toBe('none');
    });

    test('_applyTypeToParamSelect: switching back to digitalIndicator re-shows param row', async ({ page }) => {
        const result = await page.evaluate(() => {
            document.querySelector('#ni_settingsBody').style.display = '';
            _applyTypeToParamSelect('timeIndicator');
            const after_time = document.querySelector('#ni_paramRow').style.display;
            _applyTypeToParamSelect('digitalIndicator');
            const after_digital = document.querySelector('#ni_paramRow').style.display;
            return { after_time, after_digital };
        });
        expect(result.after_time).toBe('none');
        expect(result.after_digital).not.toBe('none');
    });

    test('closes when clicking Отмена', async ({ page }) => {
        await page.click('#newItemModal .cancelBtn');
        await expect(page.locator('#newItemModal')).not.toBeVisible();
    });
});

// ── Time indicator — timezone display ─────────────────────────────────────────

test.describe('Time indicator — timezone rendering', () => {
    test.beforeEach(async ({ page }) => {
        await gotoWithAuth(page);
        await page.waitForSelector('#wsCanvas');
    });

    test('setValue formats time in UTC+3 (Moscow): epoch 12:00 UTC → 15:00', async ({ page }) => {
        const result = await page.evaluate(() => {
            const el = document.createElement('div');
            el.className = 'indicator timeIndicator';
            const val = document.createElement('div');
            val.className = 'indicatorValue';
            el.appendChild(val);
            document.querySelector('#wsCanvas').appendChild(el);

            const origTz = _settings.timezone;
            _settings.timezone = 'Europe/Moscow';
            // 2024-05-20 12:00:00 UTC
            _indicatorTypes.timeIndicator.setValue(el, 1716206400);
            _settings.timezone = origTz;

            const text = val.textContent;
            el.remove();
            return text;
        });

        expect(result).toBe('15:00:00');
    });

    test('setValue formats date in UTC+3 (Moscow) correctly', async ({ page }) => {
        const result = await page.evaluate(() => {
            const el = document.createElement('div');
            el.className = 'indicator dateIndicator';
            const val = document.createElement('div');
            val.className = 'indicatorValue';
            el.appendChild(val);
            document.querySelector('#wsCanvas').appendChild(el);

            const origTz = _settings.timezone;
            _settings.timezone = 'Europe/Moscow';
            // 2024-05-20 00:30:00 UTC → Moscow = 2024-05-20 03:30 (same date)
            _indicatorTypes.dateIndicator.setValue(el, 1716165000);
            _settings.timezone = origTz;

            const text = val.textContent;
            el.remove();
            return text;
        });

        expect(result).toMatch(/20\.05\.2024/);
    });

    test('setValue uses HH:MM:SS format when timezone is empty (local time)', async ({ page }) => {
        const result = await page.evaluate(() => {
            const el = document.createElement('div');
            el.className = 'indicator timeIndicator';
            const val = document.createElement('div');
            val.className = 'indicatorValue';
            el.appendChild(val);
            document.querySelector('#wsCanvas').appendChild(el);

            const origTz = _settings.timezone;
            _settings.timezone = '';
            _indicatorTypes.timeIndicator.setValue(el, 1716206400);
            _settings.timezone = origTz;

            const text = val.textContent;
            el.remove();
            return text;
        });

        expect(result).toMatch(/^\d{2}:\d{2}:\d{2}$/);
    });

    test('_lastEpoch is stored after setValue for re-render capability', async ({ page }) => {
        const stored = await page.evaluate(() => {
            const el = document.createElement('div');
            el.className = 'indicator timeIndicator';
            const val = document.createElement('div');
            val.className = 'indicatorValue';
            el.appendChild(val);
            document.querySelector('#wsCanvas').appendChild(el);

            _indicatorTypes.timeIndicator.setValue(el, 1716206400);
            const result = el._lastEpoch;
            el.remove();
            return result;
        });

        expect(stored).toBe(1716206400);
    });
});

// ── _refreshTimeIndicators ────────────────────────────────────────────────────

test.describe('_refreshTimeIndicators', () => {
    test('re-renders indicator with new timezone without new SSE data', async ({ page }) => {
        await gotoWithAuth(page);
        await page.waitForSelector('#wsCanvas');

        const result = await page.evaluate(() => {
            const el = document.createElement('div');
            el.className = 'indicator timeIndicator';
            const val = document.createElement('div');
            val.className = 'indicatorValue';
            el.appendChild(val);
            document.querySelector('#wsCanvas').appendChild(el);

            // First render in UTC
            _settings.timezone = 'UTC';
            _indicatorTypes.timeIndicator.setValue(el, 1716206400);
            const before = val.textContent; // "12:00:00"

            // Change timezone, no new SSE data — _refreshTimeIndicators re-renders
            _settings.timezone = 'Europe/Moscow';
            _refreshTimeIndicators();
            const after = val.textContent; // should be "15:00:00"

            el.remove();
            _settings.timezone = '';
            return { before, after };
        });

        expect(result.before).toBe('12:00:00');
        expect(result.after).toBe('15:00:00');
    });
});

// ── SSE drill-data event handling ─────────────────────────────────────────────

test.describe('drill-data SSE handler', () => {
    test('time indicator updates when simulated drill-data record arrives', async ({ page }) => {
        await gotoWithAuth(page);
        await page.waitForSelector('#wsCanvas');

        const text = await page.evaluate(() => {
            const el = document.createElement('div');
            el.className = 'indicator timeIndicator';
            el.dataset.paramId = '';
            const val = document.createElement('div');
            val.className = 'indicatorValue';
            val.textContent = '00:00:00';
            el.appendChild(val);
            document.querySelector('#wsCanvas').appendChild(el);

            _settings.timezone = 'UTC'; // deterministic

            // Replay what the drill-data SSE handler does in main.js
            const record = { params: {}, time: 1716206400 }; // 12:00:00 UTC
            if (record.time) {
                document.querySelectorAll('.timeIndicator, .dateIndicator')
                    .forEach(function (ind) { setIndicatorValue(ind, record.time); });
            }

            const result = val.textContent;
            el.remove();
            _settings.timezone = '';
            return result;
        });

        expect(text).toBe('12:00:00');
    });
});
