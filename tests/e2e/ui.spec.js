'use strict';
// @ts-check
//
// Табло показывает то, что прислал BCS_DrillerMonitorLoader, и ничего не
// настраивает. Эти проверки идут в настоящем браузере против локального
// сервера (playwright.config.js: baseURL http://localhost:3000) — боевое
// устройство здесь не участвует.

const { test, expect } = require('@playwright/test');

const PROFILE = 'E2E-показ';
const P_DEPTH = 53;     // глубина забоя
const P_WEIGHT = 0;     // вес на крюке

/// Раскладку задаёт Loader — тем же запросом, что и в бою
async function pushConfig(request) {
    const mk = (paramId, left, header) => ({
        param_id: paramId, type: 'digitalIndicator',
        pos_left: left, pos_top: 10, width: 25, height: 20,
        header_text: header, header_color: '#c9d1d9', header_bg: '#161b22',
        header_font: 0, header_size: 14,
        format: '0000.00', value_color: '#38bdf8', value_bg: '#0d1117',
        value_font: 0, value_size: 48,
        range_min: 0, range_max: 10000,
        alarm_enabled: 0, alarm_min: null, alarm_max: null, alarm_color: '#ff0000',
        units: '', zone_colors: 0, ticker_speed: 12, value_bg_opacity: 0, extra_data: null,
    });
    const resp = await request.post('/api/push/config', {
        data: {
            config: {
                profile: { name: PROFILE, background: '#000000', cellSize: 20,
                           wsWidth: 1920, wsHeight: 1080, timezone: '0',
                           alarmSoundId: null, alarmVolume: 50, alarmDelay: 2, sidebarTimeout: 20 },
                indicators: [mk(P_DEPTH, 10, 'Глубина забоя'), mk(P_WEIGHT, 45, 'Вес на крюке')],
                activate: true,
            },
        },
    });
    expect(resp.ok()).toBeTruthy();
}

async function open(page) {
    await page.goto('/');
    await page.waitForSelector('#wsCanvas');
}

async function value(page, paramId) {
    return page.evaluate(
        (id) => {
            const el = document.querySelector('.indicator[data-param-id="' + id + '"]');
            return el ? el._currentValue : null;
        },
        paramId);
}

test.describe('Табло: только показ', () => {
    test.beforeEach(async ({ request }) => { await pushConfig(request); });

    test('страница грузится без ошибок JS', async ({ page }) => {
        const errors = [];
        page.on('pageerror', (e) => errors.push(e.message));
        await open(page);
        await page.waitForTimeout(1200);
        expect(errors).toEqual([]);
    });

    test('в боковой панели только журнал и версия', async ({ page }) => {
        await open(page);
        await expect(page.locator('#logButton')).toBeAttached();
        await expect(page.locator('#versionButton')).toBeAttached();

        for (const gone of ['#workSpaceSettings', '#networkButton', '#gridButton',
                            '#indicatorListButton', '#parametersButton', '#addButton',
                            '#removeButton', '#saveButton', '#loginModal', '#newItemModal',
                            '#settings', '#networkSettingsModal']) {
            await expect(page.locator(gone)).toHaveCount(0);
        }
    });

    test('панель открывается по логотипу без пароля', async ({ page }) => {
        await open(page);
        await page.click('#sideBarLogo');
        await expect(page.locator('#sideBar')).toHaveClass(/open/);
    });

    test('раскладка приходит от Loader и рисуется', async ({ page }) => {
        await open(page);
        await expect(page.locator('.indicator[data-param-id="' + P_DEPTH + '"]')).toHaveCount(1);
        await expect(page.locator('.indicator[data-param-id="' + P_WEIGHT + '"]')).toHaveCount(1);
        await expect(page.locator('.indicator[data-param-id="' + P_DEPTH + '"] .indicatorHeader'))
            .toHaveText('Глубина забоя');
    });
});

test.describe('Значения показываются как присланы', () => {
    test.beforeEach(async ({ request }) => { await pushConfig(request); });

    test('индикатор принимает значение из пакета', async ({ page, request }) => {
        await open(page);
        await request.post('/api/push/data', {
            data: { recNo: 1, depth: 1500, time: 0, params: { [P_DEPTH]: 10.5, [P_WEIGHT]: 97.25 } },
        });
        await expect.poll(() => value(page, P_WEIGHT)).toBe(97.25);
    });

    test('поле depth записи НЕ затирает параметр глубины', async ({ page, request }) => {
        // Данные готовит Loader; табло не имеет права подменять их своим
        // справочником — иначе одно и то же значение преобразуется дважды
        await open(page);
        await request.post('/api/push/data', {
            data: { recNo: 2, depth: 1500, time: 0, params: { [P_DEPTH]: 10.5 } },
        });
        await expect.poll(() => value(page, P_DEPTH)).toBe(10.5);
    });

    test('обрыв передачи показывает баннер', async ({ page, request }) => {
        await open(page);
        await request.post('/api/push/data', { data: { recNo: 3, depth: 0, time: 0, params: { [P_WEIGHT]: 1 } } });
        await request.post('/api/push/state', { data: { running: false, reason: 'остановлено оператором' } });
        await expect(page.locator('#dataBanner')).toHaveClass(/visible/);
        await expect(page.locator('#dataBannerText')).toContainText('остановлено оператором');
    });
});

test.describe('Журнал и диагностика', () => {
    test('окно журнала показывает состояние подсистем', async ({ page }) => {
        await open(page);
        await page.click('#sideBarLogo');
        await page.click('#logButton');
        await page.waitForSelector('#logModal[open]');
        await expect(page.locator('#diagBody .diagHead')).toContainText('Состояние');
        // Проверки самодиагностики: RS-485, данные, диск, память, часы, видео
        await expect(page.locator('#diagBody .diagRow')).toHaveCount(6);
        // Очистка журнала с табло убрана — чистят из Loader
        await expect(page.locator('#logModal .deleteBtn')).toHaveCount(0);
    });
});
