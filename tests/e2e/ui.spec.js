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

// Timezone model: _settings.timezone is a UTC offset in hours as a string
// ('0', '3', '-5') or '' for the browser's local time. The settings modal
// exposes it as a number input #ws_timezone (-12..12).
const TZ_UTC    = '0';
const TZ_MOSCOW = '3';
const TZ_YEKB   = '5';
const TZ_LOCAL  = '';

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

    test('UTC offset input is present and bounded to -12..12', async ({ page }) => {
        await openSettingsModal(page);
        const tz = page.locator('#ws_timezone');
        await expect(tz).toBeVisible();
        await expect(tz).toHaveAttribute('type', 'number');
        await expect(tz).toHaveAttribute('min', '-12');
        await expect(tz).toHaveAttribute('max', '12');
        // Populated from the active profile: a whole number of hours
        expect(await tz.inputValue()).toMatch(/^-?\d{1,2}$/);
    });

    test('out-of-range UTC offset falls back to 0 on OK', async ({ page }) => {
        await openSettingsModal(page);
        await page.fill('#ws_timezone', '99');
        await page.click('#settings .okBtn');
        await page.waitForSelector('#settings', { state: 'hidden' });
        const tz = await page.evaluate(() => _settings.timezone);
        expect(tz).toBe(TZ_UTC);
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
    test('UTC offset is still set after save → reload', async ({ page }) => {
        await gotoWithAuth(page);

        // Pick UTC+5 (Yekaterinburg)
        await openSettingsModal(page);
        await page.fill('#ws_timezone', TZ_YEKB);
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
        expect(value).toBe(TZ_YEKB);

        // Cleanup: back to UTC
        await page.fill('#ws_timezone', TZ_UTC);
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

    test('_applyTypeToParamSelect: timeIndicator pins param 52 and locks the inputs', async ({ page }) => {
        // Parameters are fetched asynchronously when the modal opens
        await page.waitForFunction(() => Array.isArray(_availableParams) && _availableParams.length > 0);
        const result = await page.evaluate(() => {
            document.querySelector('#ni_settingsBody').style.display = '';
            _applyTypeToParamSelect('timeIndicator');
            const input  = document.querySelector('#ni_paramId');
            const header = document.querySelector('#ni_headerText');
            return {
                rowDisplay:     document.querySelector('#ni_paramRow').style.display,
                paramId:        input.dataset.paramId,
                paramDisabled:  input.disabled,
                headerText:     header.value,
                headerDisabled: header.disabled,
            };
        });
        expect(result.rowDisplay).not.toBe('none');
        expect(result.paramId).toBe('52');
        expect(result.paramDisabled).toBe(true);
        expect(result.headerText).toBe('Время сбора данных');
        expect(result.headerDisabled).toBe(true);
    });

    test('_applyTypeToParamSelect: dateIndicator hides param row', async ({ page }) => {
        const display = await page.evaluate(() => {
            document.querySelector('#ni_settingsBody').style.display = '';
            _applyTypeToParamSelect('dateIndicator');
            return document.querySelector('#ni_paramRow').style.display;
        });
        expect(display).toBe('none');
    });

    test('_applyTypeToParamSelect: switching back to digitalIndicator re-shows and unlocks param row', async ({ page }) => {
        const result = await page.evaluate(() => {
            document.querySelector('#ni_settingsBody').style.display = '';
            const row   = document.querySelector('#ni_paramRow');
            const input = document.querySelector('#ni_paramId');
            _applyTypeToParamSelect('dateIndicator');
            const after_date = { display: row.style.display, disabled: input.disabled };
            _applyTypeToParamSelect('digitalIndicator');
            const after_digital = { display: row.style.display, disabled: input.disabled };
            return { after_date, after_digital };
        });
        expect(result.after_date.display).toBe('none');
        expect(result.after_date.disabled).toBe(true);
        expect(result.after_digital.display).not.toBe('none');
        expect(result.after_digital.disabled).toBe(false);
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

    test('setValue formats time in UTC+3: epoch 12:00 UTC → 15:00', async ({ page }) => {
        const result = await page.evaluate((tz) => {
            const el = document.createElement('div');
            el.className = 'indicator timeIndicator';
            const val = document.createElement('div');
            val.className = 'indicatorValue';
            el.appendChild(val);
            document.querySelector('#wsCanvas').appendChild(el);

            const origTz = _settings.timezone;
            _settings.timezone = tz;
            // 2024-05-20 12:00:00 UTC
            _indicatorTypes.timeIndicator.setValue(el, 1716206400);
            _settings.timezone = origTz;

            const text = val.textContent;
            el.remove();
            return text;
        }, TZ_MOSCOW);

        expect(result).toBe('15:00:00');
    });

    test('setValue formats time with a negative offset: epoch 02:00 UTC at UTC-5 → 21:00 previous day', async ({ page }) => {
        const result = await page.evaluate(() => {
            const el = document.createElement('div');
            el.className = 'indicator timeIndicator';
            const val = document.createElement('div');
            val.className = 'indicatorValue';
            el.appendChild(val);
            document.querySelector('#wsCanvas').appendChild(el);

            const origTz = _settings.timezone;
            _settings.timezone = '-5';
            // 2024-05-20 02:00:00 UTC
            _indicatorTypes.timeIndicator.setValue(el, 1716170400);
            _settings.timezone = origTz;

            const text = val.textContent;
            el.remove();
            return text;
        });

        expect(result).toBe('21:00:00');
    });

    test('setValue formats date in UTC+3 correctly', async ({ page }) => {
        const result = await page.evaluate((tz) => {
            const el = document.createElement('div');
            el.className = 'indicator dateIndicator';
            const val = document.createElement('div');
            val.className = 'indicatorValue';
            el.appendChild(val);
            document.querySelector('#wsCanvas').appendChild(el);

            const origTz = _settings.timezone;
            _settings.timezone = tz;
            // 2024-05-20 00:30:00 UTC → UTC+3 = 2024-05-20 03:30 (same date)
            _indicatorTypes.dateIndicator.setValue(el, 1716165000);
            _settings.timezone = origTz;

            const text = val.textContent;
            el.remove();
            return text;
        }, TZ_MOSCOW);

        expect(result).toBe('20.05.2024');
    });

    test('setValue uses HH:MM:SS format when timezone is empty (local time)', async ({ page }) => {
        const result = await page.evaluate((tz) => {
            const el = document.createElement('div');
            el.className = 'indicator timeIndicator';
            const val = document.createElement('div');
            val.className = 'indicatorValue';
            el.appendChild(val);
            document.querySelector('#wsCanvas').appendChild(el);

            const origTz = _settings.timezone;
            _settings.timezone = tz;
            _indicatorTypes.timeIndicator.setValue(el, 1716206400);
            _settings.timezone = origTz;

            const text = val.textContent;
            el.remove();
            return text;
        }, TZ_LOCAL);

        expect(result).toMatch(/^\d{2}:\d{2}:\d{2}$/);
    });

    test('setValue(null) shows the "no data" placeholder', async ({ page }) => {
        const result = await page.evaluate(() => {
            const el = document.createElement('div');
            el.className = 'indicator timeIndicator';
            const val = document.createElement('div');
            val.className = 'indicatorValue';
            el.appendChild(val);
            document.querySelector('#wsCanvas').appendChild(el);

            setIndicatorValue(el, null);

            const text = val.textContent;
            el.remove();
            return text;
        });

        expect(result).toBe('--:--:--');
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
    test('re-renders indicator with new UTC offset without new SSE data', async ({ page }) => {
        await gotoWithAuth(page);
        await page.waitForSelector('#wsCanvas');

        const result = await page.evaluate(({ utc, moscow }) => {
            const el = document.createElement('div');
            el.className = 'indicator timeIndicator';
            const val = document.createElement('div');
            val.className = 'indicatorValue';
            el.appendChild(val);
            document.querySelector('#wsCanvas').appendChild(el);

            const origTz = _settings.timezone;

            // First render in UTC
            _settings.timezone = utc;
            _indicatorTypes.timeIndicator.setValue(el, 1716206400);
            const before = val.textContent; // "12:00:00"

            // Change offset, no new SSE data — _refreshTimeIndicators re-renders
            _settings.timezone = moscow;
            _refreshTimeIndicators();
            const after = val.textContent; // should be "15:00:00"

            el.remove();
            _settings.timezone = origTz;
            return { before, after };
        }, { utc: TZ_UTC, moscow: TZ_MOSCOW });

        expect(result.before).toBe('12:00:00');
        expect(result.after).toBe('15:00:00');
    });
});

// ── SSE drill-data event handling ─────────────────────────────────────────────

test.describe('drill-data SSE handler', () => {
    test('time indicator updates when simulated drill-data record arrives', async ({ page }) => {
        await gotoWithAuth(page);
        await page.waitForSelector('#wsCanvas');

        const text = await page.evaluate((tz) => {
            const el = document.createElement('div');
            el.className = 'indicator timeIndicator';
            el.dataset.paramId = '';
            const val = document.createElement('div');
            val.className = 'indicatorValue';
            val.textContent = '00:00:00';
            el.appendChild(val);
            document.querySelector('#wsCanvas').appendChild(el);

            const origTz = _settings.timezone;
            _settings.timezone = tz; // deterministic

            // Replay what the drill-data SSE handler does in main.js
            const record = { params: {}, time: 1716206400 }; // 12:00:00 UTC
            if (record.time) {
                document.querySelectorAll('.timeIndicator, .dateIndicator')
                    .forEach(function (ind) { setIndicatorValue(ind, record.time); });
            }

            const result = val.textContent;
            el.remove();
            _settings.timezone = origTz;
            return result;
        }, TZ_UTC);

        expect(text).toBe('12:00:00');
    });
});
