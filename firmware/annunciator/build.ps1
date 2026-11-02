# Сборка прошивки оповещателя (Windows, Arduino IDE 2 с ядром Digistump AVR).
#
#   powershell -ExecutionPolicy Bypass -File firmware\annunciator\build.ps1
#
# Драйвер V-USB в репозиторий не кладём: он берётся из библиотеки
# DigisparkKeyboard установленного ядра Digistump, а его usbconfig.h правится
# под это устройство. Результат — annunciator.hex рядом со скриптом; заливать
# с табла (там USB 2.0): ~/tools/micronucleus --run annunciator.hex
#
# Идентификатор — общий для HID пары V-USB (16c0:05df), устройство отличается
# строками производителя и названия, как требуют правила этой пары
# (USB-IDs-for-free.txt). По ним же его ищет табло (server/annunciator.js).

$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path

$core = Join-Path $env:LOCALAPPDATA 'Arduino15\packages\digistump\hardware\avr\1.6.7'
$lib  = Join-Path $core 'libraries\DigisparkKeyboard'
$cli  = 'C:\Program Files\Arduino IDE\resources\app\lib\backend\resources\arduino-cli.exe'
if (-not (Test-Path $lib)) { throw "Нет библиотеки DigisparkKeyboard: $lib" }
if (-not (Test-Path $cli)) { throw "Нет arduino-cli: $cli" }

$work   = Join-Path $env:TEMP 'annunciator-build'
$sketch = Join-Path $work 'annunciator'
$libs   = Join-Path $work 'libraries'
$usb    = Join-Path $libs 'AnnunciatorUSB'
if (Test-Path $work) { Remove-Item $work -Recurse -Force }
New-Item -ItemType Directory -Force $sketch, $usb | Out-Null

Copy-Item (Join-Path $here 'annunciator.ino') $sketch

# Драйвер — отдельной библиотекой, а не файлами скетча: Arduino компилирует
# библиотеку на месте, и usbdrvasm.S находит свои .inc (из папки скетча их не
# копируют). Заголовок AnnunciatorUSB.h нужен, чтобы выбрали эту библиотеку,
# а не одну из библиотек Digistump с таким же usbdrv.h.
Get-ChildItem $lib -File | Where-Object { $_.Extension -in '.c', '.h', '.S', '.inc' -and $_.Name -notin 'DigiKeyboard.h', 'scancode-ascii-table.h' } |
    ForEach-Object { Copy-Item $_.FullName $usb }
Set-Content (Join-Path $usb 'AnnunciatorUSB.h') -Encoding ASCII -Value @(
    '#pragma once',
    '#ifdef __cplusplus',
    'extern "C" {',
    '#endif',
    '#include "usbdrv.h"',
    '#ifdef __cplusplus',
    '}',
    '#endif')
Set-Content (Join-Path $usb 'library.properties') -Encoding ASCII -Value @(
    'name=AnnunciatorUSB', 'version=1.0.0', 'author=V-USB (obdev), Digistump',
    'maintainer=DrillMonitorWeb', 'sentence=V-USB for the annunciator', 'paragraph=',
    'category=Communication', 'url=https://www.obdev.at/vusb/', 'architectures=avr')

# ── usbconfig.h под оповещатель ──────────────────────────────────────────────
$cfgPath = Join-Path $usb 'usbconfig.h'
$cfg = [IO.File]::ReadAllText($cfgPath)

function Set-Define([string]$name, [string]$value) {
    $re = '(?m)^(#define\s+' + [regex]::Escape($name) + '\s+)[^\r\n/]*'
    if (-not [regex]::IsMatch($script:cfg, $re)) { throw "В usbconfig.h нет $name" }
    $script:cfg = [regex]::Replace($script:cfg, $re, { param($m) $m.Groups[1].Value + $value + ' ' }, 1)
}

function Chars([string]$s) { ($s.ToCharArray() | ForEach-Object { "'$_'" }) -join ',' }

$vendor  = 'drillmonitor.bcs'
$product = 'Annunciator'

Set-Define 'USB_CFG_IMPLEMENT_FN_WRITE'            '1'
Set-Define 'USB_CFG_DEVICE_ID'                     '0xdf, 0x05'
Set-Define 'USB_CFG_VENDOR_NAME'                   (Chars $vendor)
Set-Define 'USB_CFG_VENDOR_NAME_LEN'               ([string]$vendor.Length)
Set-Define 'USB_CFG_DEVICE_NAME'                   (Chars $product)
Set-Define 'USB_CFG_DEVICE_NAME_LEN'               ([string]$product.Length)
Set-Define 'USB_CFG_INTERFACE_SUBCLASS'            '0x00'
Set-Define 'USB_CFG_INTERFACE_PROTOCOL'            '0x00'
Set-Define 'USB_CFG_HID_REPORT_DESCRIPTOR_LENGTH'  '27'
[IO.File]::WriteAllText($cfgPath, $cfg)

# ── сборка ───────────────────────────────────────────────────────────────────
$out = Join-Path $work 'build'
& $cli compile --fqbn digistump:avr:digispark-tiny --libraries $libs --output-dir $out $sketch
if ($LASTEXITCODE -ne 0) { throw "Сборка не удалась (код $LASTEXITCODE)" }

Copy-Item (Join-Path $out 'annunciator.ino.hex') (Join-Path $here 'annunciator.hex') -Force
"Готово: " + (Join-Path $here 'annunciator.hex')
