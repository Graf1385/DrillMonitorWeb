// Оповещатель табла: Digispark (ATtiny85, Model A) на USB сервера табла.
//
//   P0 — реле оповещателя (активный высокий уровень)
//   P1 — штатный светодиод платы
//   P2 — кнопка на землю (внешняя подтяжка 10 кОм на 5 В + внутренняя)
//
// Решений плата не принимает: тревогу решает сервер табла (server/alarm.js),
// он же решает, что значит нажатие. Плата замыкает реле, когда велели, и
// сообщает о нажатиях.
//
// Связь — HID-устройство с вендорскими отчётами: Linux отдаёт его как
// /dev/hidraw*, и сервер читает и пишет его как обычный файл, без нативных
// модулей (server/annunciator.js).
//
//   Входной отчёт (плата → табло), 8 байт, каждые 250 мс — это и сердцебиение:
//     [0] версия протокола (1)
//     [1] флаги: бит0 — реле замкнуто, бит1 — кнопка нажата сейчас,
//                бит2 — связь с табло есть
//     [2] счётчик коротких нажатий     (по кругу 0…255)
//     [3] счётчик длинных нажатий, ≥ 2 с
//     [4..7] 0
//   Счётчики, а не события: пропавший отчёт не теряет нажатие.
//
//   Выходной отчёт (табло → плата), 8 байт, сервер шлёт каждые 500 мс:
//     [0] реле: 1 — замкнуть, 0 — разомкнуть
//     [1] номер посылки
//     [2] последний увиденный табло счётчик коротких нажатий
//     [3] последний увиденный счётчик длинных
//
// Сторож: нет выходного отчёта HOST_TIMEOUT_MS — реле размыкается. Служба
// упала, USB отвалился — сирена не должна выть вечно.
//
// Светодиод: короткая вспышка раз в секунду — связь с табло есть; погашен —
// связи нет; горит 200 мс — табло приняло нажатие (вернуло счётчик).
//
// Первые ~5 с после подачи питания работает загрузчик micronucleus, P0 в это
// время не определён — поэтому модуль реле с оптопарой и активным высоким.
//
// Сборка — build.ps1 рядом: драйвер V-USB берётся из библиотеки
// DigisparkKeyboard ядра Digistump, usbconfig.h правится под это устройство.

#include <Arduino.h>
#include <avr/pgmspace.h>
#include <avr/interrupt.h>
#include <util/delay.h>
#include <string.h>

#include <AnnunciatorUSB.h>   // V-USB; собирает build.ps1

static const uint8_t PIN_RELAY  = 0;
static const uint8_t PIN_LED    = 1;
static const uint8_t PIN_BUTTON = 2;

static const uint8_t  PROTOCOL_VERSION = 1;
static const uint16_t REPORT_EVERY_MS  = 250;
static const uint16_t HOST_TIMEOUT_MS  = 3000;
static const uint16_t DEBOUNCE_MS      = 30;
static const uint16_t LONG_PRESS_MS    = 2000;
static const uint16_t ACK_FLASH_MS     = 200;

// Вендорский HID: 8 байт на вход, 8 на выход, без номеров отчётов.
// Длина (27) должна совпадать с USB_CFG_HID_REPORT_DESCRIPTOR_LENGTH.
extern "C" {
const PROGMEM char usbHidReportDescriptor[27] = {
    0x06, 0x00, 0xff,   // USAGE_PAGE (Vendor Defined Page 1)
    0x09, 0x01,         // USAGE (Vendor Usage 1)
    0xa1, 0x01,         // COLLECTION (Application)
    0x15, 0x00,         //   LOGICAL_MINIMUM (0)
    0x26, 0xff, 0x00,   //   LOGICAL_MAXIMUM (255)
    0x75, 0x08,         //   REPORT_SIZE (8)
    0x95, 0x08,         //   REPORT_COUNT (8)
    0x09, 0x01,         //   USAGE (Vendor Usage 1)
    0x81, 0x02,         //   INPUT (Data,Var,Abs)
    0x95, 0x08,         //   REPORT_COUNT (8)
    0x09, 0x01,         //   USAGE (Vendor Usage 1)
    0x91, 0x02,         //   OUTPUT (Data,Var,Abs)
    0xc0                // END_COLLECTION
};
}

static uchar    inReport[8];
static uchar    outReport[8];
static uchar    outPos;

static volatile bool hostSeen = false;   // был ли хоть один выходной отчёт
static volatile unsigned long hostAt = 0;
static volatile uchar hostRelay   = 0;
static volatile uchar hostAckShort = 0;
static volatile uchar hostAckLong  = 0;

static uchar shortCount = 0;
static uchar longCount  = 0;
static uchar flashedShort = 0;           // до какого счётчика уже мигнули
static uchar flashedLong  = 0;

// ── USB ─────────────────────────────────────────────────────────────────────

extern "C" usbMsgLen_t usbFunctionSetup(uchar data[8])
{
    usbRequest_t *rq = (usbRequest_t *)((void *)data);
    if ((rq->bmRequestType & USBRQ_TYPE_MASK) != USBRQ_TYPE_CLASS) return 0;

    if (rq->bRequest == USBRQ_HID_GET_REPORT) {
        // Табло может спросить и само — отдаём то же, что шлём по прерыванию
        usbMsgPtr = inReport;               // в V-USB Digistump это uchar*
        return sizeof(inReport);
    }
    if (rq->bRequest == USBRQ_HID_SET_REPORT) {
        // Выходной отчёт приходит управляющей посылкой (своей точки OUT у
        // нас нет); данные — в usbFunctionWrite
        outPos = 0;
        return USB_NO_MSG;
    }
    return 0;
}

extern "C" uchar usbFunctionWrite(uchar *data, uchar len)
{
    for (uchar i = 0; i < len && outPos < sizeof(outReport); i++) outReport[outPos++] = data[i];
    if (outPos < sizeof(outReport)) return 0;            // ждём продолжения

    hostRelay    = outReport[0] ? 1 : 0;
    hostAckShort = outReport[2];
    hostAckLong  = outReport[3];
    hostAt       = millis();
    hostSeen     = true;
    return 1;
}

// ── Кнопка ──────────────────────────────────────────────────────────────────

static bool buttonDown = false;         // устойчивое состояние после антидребезга
static bool rawLast    = false;
static unsigned long rawChangedAt = 0;
static unsigned long pressedAt    = 0;
static bool longCounted = false;

static void pollButton(unsigned long now)
{
    bool raw = digitalRead(PIN_BUTTON) == LOW;
    if (raw != rawLast) { rawLast = raw; rawChangedAt = now; return; }
    if (raw == buttonDown || now - rawChangedAt < DEBOUNCE_MS) {
        // Длинное засчитываем, как только держат 2 с, — не дожидаясь отпускания:
        // оператор сразу видит, что сирену глушат
        if (buttonDown && !longCounted && now - pressedAt >= LONG_PRESS_MS) {
            longCounted = true;
            longCount++;
        }
        return;
    }
    buttonDown = raw;
    if (buttonDown) {
        pressedAt   = now;
        longCounted = false;
    } else if (!longCounted) {
        shortCount++;
    }
}

// ── Отчёт и сторож ──────────────────────────────────────────────────────────

static bool hostAlive(unsigned long now)
{
    bool seen;
    unsigned long at;
    cli(); seen = hostSeen; at = hostAt; sei();
    return seen && now - at < HOST_TIMEOUT_MS;
}

static void fillReport(bool relay, bool alive)
{
    memset(inReport, 0, sizeof(inReport));
    inReport[0] = PROTOCOL_VERSION;
    inReport[1] = (relay ? 1 : 0) | (buttonDown ? 2 : 0) | (alive ? 4 : 0);
    inReport[2] = shortCount;
    inReport[3] = longCount;
}

void setup()
{
    // Реле гасим первым действием
    pinMode(PIN_RELAY, OUTPUT);
    digitalWrite(PIN_RELAY, LOW);
    pinMode(PIN_LED, OUTPUT);
    digitalWrite(PIN_LED, LOW);
    pinMode(PIN_BUTTON, INPUT_PULLUP);

    cli();
    usbDeviceDisconnect();          // заставить хост перечислить устройство заново
    _delay_ms(250);
    usbDeviceConnect();
    usbInit();
    sei();
}

void loop()
{
    static unsigned long reportAt = 0;
    static unsigned long flashUntil = 0;

    usbPoll();
    unsigned long now = millis();

    pollButton(now);

    bool alive = hostAlive(now);
    uchar wantRelay;
    cli(); wantRelay = hostRelay; sei();
    bool relay = alive && wantRelay;
    digitalWrite(PIN_RELAY, relay ? HIGH : LOW);

    // Табло вернуло счётчик — нажатие принято, мигаем
    uchar ackS, ackL;
    cli(); ackS = hostAckShort; ackL = hostAckLong; sei();
    if (alive && (ackS != flashedShort || ackL != flashedLong)) {
        if (ackS == shortCount || ackL == longCount) flashUntil = now + ACK_FLASH_MS;
        flashedShort = ackS;
        flashedLong  = ackL;
    }

    bool led;
    if ((long)(flashUntil - now) > 0) led = true;
    else led = alive && (now % 1000) < 40;
    digitalWrite(PIN_LED, led ? HIGH : LOW);

    if (now - reportAt >= REPORT_EVERY_MS && usbInterruptIsReady()) {
        reportAt = now;
        fillReport(relay, alive);
        usbSetInterrupt(inReport, sizeof(inReport));
    }
}
