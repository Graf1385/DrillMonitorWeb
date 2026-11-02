#!/usr/bin/python3 -I
# -*- coding: utf-8 -*-
"""
DrillMonitorWeb: установка пакета обновления. Запускается от root через sudo
(см. /etc/sudoers.d/drillmonitor), лежит в /usr/local/lib/drillmonitor и
пакетом обновления не заменяется.

    apply-update.py <пакет.tgz>           проверить и установить
    apply-update.py --check <пакет.tgz>   только проверить (root не нужен)

Почему распаковка здесь, а не в службе. Код программы принадлежит root, и
служба писать в него не может: иначе любая её ошибка, как и любой пакет,
превращались в root — сервисный пользователь мог подменить скрипты, которые
сам же запускает через sudo. Теперь пакет ставит root, но только в каталог
программы и только по правилам ниже, а код из пакета работает с правами
службы, как и прежде.

Правила:
  • пути только внутри установки: ни абсолютных, ни «..»;
  • только файлы, каталоги и ссылки; ссылки не ведут наружу;
  • ничего не пишется через символическую ссылку — ни сам файл, ни каталог
    на пути к нему (server/data принадлежит службе, и подложить туда ссылку
    на /etc/shadow она могла бы);
  • рабочее состояние табло (база, настройки линии и табла) не заменяется;
  • биты setuid/setgid и запись для группы и прочих снимаются.

Перед распаковкой прежняя версия сохраняется в backup/, при сбое распаковки
она же возвращается на место. Результат — строка JSON в stdout, ошибка —
текст для оператора в stderr и код 1.
"""

import json
import os
import pwd
import re
import stat
import sys
import tarfile
import tempfile
import time

ROOT         = '/opt/drillmonitor'
APP_USER     = 'drillmonitor'
BACKUP_DIR   = os.path.join(ROOT, 'backup')
KEEP_BACKUPS = 2
DATA_DIR     = 'server/data'

# Потолки — как в server/updatePackage.js, плюс предел распакованного объёма:
# сжатый архив в 100 МБ может развернуться во что угодно
MAX_BYTES          = 100 * 1024 * 1024
MAX_UNPACKED_BYTES = 1024 * 1024 * 1024

BACKUP_PATHS = ['app.js', 'package.json', 'package-lock.json', 'server', 'public', 'scripts']

# Рабочее состояние устройства (тот же список, что в updatePackage.js)
RUNTIME_STATE = re.compile(
    r'^server/data/([^/]*\.db(-shm|-wal)?|serial-settings\.json|'
    r'data-source-settings\.json|board-settings\.json)$')


class Refused(Exception):
    """Пакет не ставим; текст — для оператора."""


# ── Разбор архива ─────────────────────────────────────────────────────────────

def _norm(name):
    """Имя элемента без «.» и пустых компонентов; абсолютное остаётся абсолютным."""
    n = name.replace('\\', '/')
    if n.startswith('/'):
        return n                                  # отклонит _bad_path
    return '/'.join(c for c in n.split('/') if c not in ('', '.'))


def _looks_like_root(names):
    return any(p in ('package.json', 'app.js') or p.startswith('server/') or p.startswith('public/')
               for p in names)


def _strip_depth(names):
    """Сколько компонентов пути снимать; -1 — архив не наш (как _stripDepth в JS)."""
    if _looks_like_root(names):
        return 0
    top = names[0].split('/')[0] if names else ''
    if not top or not all(p == top or p.startswith(top + '/') for p in names):
        return -1
    inner = [p[len(top) + 1:] for p in names if len(p) > len(top) + 1]
    return 1 if _looks_like_root(inner) else -1


def _bad_path(p):
    return (not p) or p.startswith('/') or any(c in ('..',) for c in p.split('/'))


def _inside(rel):
    """Путь rel (относительно установки) не выходит из неё."""
    n = os.path.normpath(rel)
    return not (n == '..' or n.startswith('../') or os.path.isabs(n))


def plan(tar):
    """
    Проверить архив целиком, ничего не записывая. Возвращает список
    (rel, member) к установке, пропущенное рабочее состояние и версию.
    """
    members = tar.getmembers()
    if not members:
        raise Refused('Архив пуст')

    names = [_norm(m.name) for m in members]
    for raw, n in zip(members, names):
        # Пустое имя — это «./», корень самого архива (tar -C dir .)
        if n and _bad_path(n):
            raise Refused('Недопустимый путь в архиве: ' + raw.name)

    strip = _strip_depth([n for n in names if n])
    if strip < 0:
        raise Refused('Это не пакет DrillMonitorWeb: в архиве нет ни package.json, ни server/')

    def rel_of(n):
        return '/'.join(n.split('/')[strip:])

    todo, skipped, regular, total = [], [], set(), 0
    version = None
    for m, n in zip(members, names):
        rel = rel_of(n)
        if not rel:
            continue                                   # сам верхний каталог
        if RUNTIME_STATE.match(rel):
            skipped.append(rel)
            continue

        if m.isdir():
            pass
        elif m.isreg():
            total += m.size
            if total > MAX_UNPACKED_BYTES:
                raise Refused('Пакет в распакованном виде больше 1 ГБ')
            regular.add(rel)
            if rel == 'package.json':
                data = tar.extractfile(m).read(1024 * 1024)
                try:
                    version = json.loads(data.decode('utf-8-sig')).get('version')
                except Exception:
                    raise Refused('В архиве испорченный package.json')
        elif m.issym():
            if os.path.isabs(m.linkname) or not _inside(os.path.join(os.path.dirname(rel), m.linkname)):
                raise Refused('Ссылка ведёт за пределы установки: ' + m.name + ' -> ' + m.linkname)
        elif m.islnk():
            target = rel_of(_norm(m.linkname))
            if _bad_path(_norm(m.linkname)) or target not in regular:
                raise Refused('Жёсткая ссылка на файл вне пакета: ' + m.name)
            todo.append((rel, m, target))
            continue
        else:
            raise Refused('В архиве недопустимый элемент (устройство или канал): ' + m.name)

        todo.append((rel, m, None))

    return todo, skipped, version


# ── Запись без следования по ссылкам ──────────────────────────────────────────

def _app_ids():
    pw = pwd.getpwnam(APP_USER)
    return pw.pw_uid, pw.pw_gid


def _is_data(rel):
    return rel == DATA_DIR or rel.startswith(DATA_DIR + '/')


_DIR_FLAGS = os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW


def _open_dir(rel, ids):
    """
    Дескриптор каталога rel внутри установки. Каждый компонент открывается
    относительно предыдущего и без следования по ссылкам, поэтому подменить
    каталог ссылкой между проверкой и записью нельзя — открытие просто
    не удастся. Недостающие каталоги создаются.
    """
    fd = os.open(ROOT, _DIR_FLAGS)
    try:
        parts = [p for p in rel.split('/') if p]
        for i, part in enumerate(parts):
            sub = '/'.join(parts[:i + 1])
            try:
                nfd = os.open(part, _DIR_FLAGS, dir_fd=fd)
            except FileNotFoundError:
                os.mkdir(part, 0o755, dir_fd=fd)
                if _is_data(sub):
                    os.chown(part, *ids, dir_fd=fd, follow_symlinks=False)
                nfd = os.open(part, _DIR_FLAGS, dir_fd=fd)
            except OSError:
                # ELOOP — ссылка, ENOTDIR — файл на месте каталога
                raise Refused('На пути установки ссылка или файл вместо каталога: ' + sub)
            os.close(fd)
            fd = nfd
        return fd
    except BaseException:
        os.close(fd)
        raise


def _clear(dfd, name, rel):
    """Убрать то, что лежит на месте файла (файл или ссылку, но не каталог)."""
    try:
        st = os.stat(name, dir_fd=dfd, follow_symlinks=False)
    except FileNotFoundError:
        return
    if stat.S_ISDIR(st.st_mode):
        raise Refused('На месте файла лежит каталог: ' + rel)
    os.unlink(name, dir_fd=dfd)


def _file_mode(m):
    return (m.mode & 0o755) | 0o644          # без setuid/setgid и чужой записи


def _write_file(rel, src, mode, ids):
    dfd = _open_dir(os.path.dirname(rel), ids)
    try:
        name = os.path.basename(rel)
        _clear(dfd, name, rel)
        # O_EXCL: если на освободившееся место успели подложить ссылку,
        # открытие не удастся, а не пойдёт по ней
        fd = os.open(name, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600, dir_fd=dfd)
        with os.fdopen(fd, 'wb') as f:
            while True:
                chunk = src.read(1024 * 1024)
                if not chunk:
                    break
                f.write(chunk)
            f.flush()
            os.fchmod(f.fileno(), mode)
            if _is_data(rel):
                os.fchown(f.fileno(), *ids)
    finally:
        os.close(dfd)


def _write_symlink(rel, target, ids):
    dfd = _open_dir(os.path.dirname(rel), ids)
    try:
        name = os.path.basename(rel)
        _clear(dfd, name, rel)
        os.symlink(target, name, dir_fd=dfd)
        if _is_data(rel):
            os.chown(name, *ids, dir_fd=dfd, follow_symlinks=False)
    finally:
        os.close(dfd)


def _open_installed(rel, ids):
    dfd = _open_dir(os.path.dirname(rel), ids)
    try:
        return os.fdopen(os.open(os.path.basename(rel), os.O_RDONLY | os.O_NOFOLLOW, dir_fd=dfd), 'rb')
    finally:
        os.close(dfd)


def install(tar, todo, ids):
    for rel, m, link_rel in todo:
        if m.isdir():
            os.close(_open_dir(rel, ids))
        elif m.isreg():
            _write_file(rel, tar.extractfile(m), _file_mode(m), ids)
        elif m.issym():
            _write_symlink(rel, m.linkname, ids)
        elif m.islnk():
            # Жёсткую ссылку ставим копией уже установленного файла: так она
            # не может указать ни на что, кроме файла из этого же пакета
            with _open_installed(link_rel, ids) as src:
                _write_file(rel, src, _file_mode(m), ids)


# ── Резервная копия ───────────────────────────────────────────────────────────

def _require_root_owned(path):
    """Каталог существует, принадлежит root и не открыт на запись группе и прочим."""
    st = os.lstat(path)
    if stat.S_ISLNK(st.st_mode) or not stat.S_ISDIR(st.st_mode) or st.st_uid != 0 \
            or st.st_mode & 0o022:
        raise Refused(path + ' не принадлежит root или открыт на запись другим — '
                      'установка не переведена на новые права, запустите install.sh')


def backup(with_modules):
    paths = [p for p in BACKUP_PATHS if os.path.lexists(os.path.join(ROOT, p))]
    if with_modules and os.path.isdir(os.path.join(ROOT, 'node_modules')):
        paths.append('node_modules')
    if not paths:
        return None

    # server/data — рабочее состояние табло: при откате оно остаётся каким было
    def keep(ti):
        n = _norm(ti.name)
        return None if _is_data(n) else ti

    name = os.path.join(BACKUP_DIR, 'before-' + time.strftime('%Y%m%d%H%M%S') + '.tgz')
    with tarfile.open(name, 'w:gz') as out:
        for p in paths:
            out.add(os.path.join(ROOT, p), arcname=p, recursive=True, filter=keep)

    old = sorted(f for f in os.listdir(BACKUP_DIR) if re.match(r'^before-\d{14}\.tgz$', f))
    for f in old[:-KEEP_BACKUPS]:
        try:
            os.unlink(os.path.join(BACKUP_DIR, f))
        except OSError:
            pass
    return name


def restore(name, ids):
    with tarfile.open(name, 'r:gz') as tar:
        todo, _, _ = plan(tar)
        install(tar, todo, ids)


# ── Точка входа ───────────────────────────────────────────────────────────────

def _copy_package(path, into):
    """
    Копия пакета в каталог, куда служба не пишет: файл ей принадлежит, и
    подменить его между проверкой и распаковкой она не должна иметь возможности.
    """
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
    with os.fdopen(fd, 'rb') as src:
        st = os.fstat(src.fileno())
        if not stat.S_ISREG(st.st_mode):
            raise Refused('Пакет обновления — не обычный файл')
        if st.st_size > MAX_BYTES:
            raise Refused('Пакет больше %d МБ' % (MAX_BYTES // 1024 // 1024))
        dest = os.path.join(into, 'package.tgz')
        with open(dest, 'wb') as out:
            while True:
                chunk = src.read(1024 * 1024)
                if not chunk:
                    break
                out.write(chunk)
    return dest


def main(argv):
    check_only = len(argv) == 3 and argv[1] == '--check'
    if not check_only and len(argv) != 2:
        sys.stderr.write('использование: apply-update.py [--check] <пакет.tgz>\n')
        return 2
    path = argv[-1]

    if check_only:
        with tarfile.open(path, 'r:gz') as tar:
            todo, skipped, version = plan(tar)
        print(json.dumps({'ok': True, 'version': version, 'files': len(todo), 'skipped': skipped}))
        return 0

    if os.geteuid() != 0:
        raise Refused('Установка обновления требует root')

    ids = _app_ids()
    # Писать от root в дерево, которое служба может перекроить, нельзя.
    # Старая установка (код принадлежит службе) сюда не проходит: её
    # переводит на новые права install.sh
    _require_root_owned(ROOT)
    if not os.path.lexists(BACKUP_DIR):
        os.mkdir(BACKUP_DIR, 0o755)
    _require_root_owned(BACKUP_DIR)
    work = tempfile.mkdtemp(prefix='incoming-', dir=BACKUP_DIR)
    try:
        pkg = _copy_package(path, work)
        with tarfile.open(pkg, 'r:gz') as tar:
            todo, skipped, version = plan(tar)
            with_modules = any(rel.startswith('node_modules/') for rel, _, _ in todo)
            saved = backup(with_modules)
            try:
                install(tar, todo, ids)
            except Exception as e:
                if saved:
                    try:
                        restore(saved, ids)
                    except Exception as e2:
                        raise Refused('Ошибка распаковки: %s; вернуть прежнюю версию не удалось: %s' % (e, e2))
                    raise Refused('Ошибка распаковки: %s — прежняя версия возвращена' % e)
                raise
        print(json.dumps({'ok': True, 'version': version,
                          'backup': os.path.basename(saved) if saved else None,
                          'skipped': skipped}))
        return 0
    finally:
        for f in os.listdir(work):
            try:
                os.unlink(os.path.join(work, f))
            except OSError:
                pass
        try:
            os.rmdir(work)
        except OSError:
            pass


if __name__ == '__main__':
    try:
        sys.exit(main(sys.argv))
    except Refused as e:
        sys.stderr.write(str(e) + '\n')
        sys.exit(1)
    except (tarfile.TarError, EOFError, OSError) as e:
        sys.stderr.write('Не удалось прочитать архив: %s\n' % e)
        sys.exit(1)
