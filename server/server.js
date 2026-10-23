const _express       = require("express");
const _app           = _express();
const _get_router    = require("./routes/get_routers");
const _post_router   = require("./routes/post_routers");
const _stream_router    = require("./routes/streams_router");
const _push_router      = require("./routes/push_router");
const _serial_router    = require("./routes/serial_router");
const streamManager  = require("./streams/StreamManager");
const serialSource   = require("./serialSource");
const selfCheck      = require("./selfCheck");
const logger         = require("./logger");
const db             = require("./db");
const _exphbs        = require('express-handlebars');

const _hbs = _exphbs.create({
    defaultLayout: 'main',
    extname: 'hbs'
});

_app.engine('hbs', _hbs.engine);
_app.set('view engine', 'hbs');
_app.set('views', './server/views');

_app.disable('x-powered-by');
_app.use(_express.json());
_app.use(_express.urlencoded({ extended : false}))
_app.use(_express.static('./public/scripts'));
_app.use(_express.static('./public/styles'));
_app.use(_express.static('./public/image'));


_app.use(_get_router);
_app.use(_post_router);
_app.use(_stream_router);
_app.use(_push_router);
_app.use(_serial_router);

function Start(port){
    const srv = _app.listen(port, ()=>{
        console.log("The server is already running...");
        console.log("http://localhost:" + port);
        logger.log('Сервер запущен на порту ' + port);
        // Приём данных по RS-485 (если порт настроен и доступен)
        serialSource.start();
        // Самодиагностика: к табло доступа нет, неисправность должна либо
        // чиниться сама, либо остаться в журнале (server/selfCheck.js)
        selfCheck.start();
    });

    // Loader шлёт записи с интервалом до 4 с, а node по умолчанию закрывает
    // простаивающее соединение через 5 с. Соединение, закрытое ровно в момент
    // отправки, приезжает в Loader как «ошибка отправки» на ровном месте —
    // держим keep-alive заведомо дольше паузы между записями.
    srv.keepAliveTimeout = 65000;
    srv.headersTimeout   = 70000;
    // Ошибки listen (EADDRINUSE и т.п.) приходят асинхронным событием —
    // try/catch их не ловит, без обработчика процесс падает необработанно
    srv.on('error', (err) => {
        console.error('Не удалось запустить сервер:', err.message);
        process.exit(1);
    });
}

// Остановка должна завершаться всегда: если уборка споткнётся, systemd ждёт
// TimeoutStopSec (полторы минуты) и добивает процесс SIGKILL — столько же
// лишнего времени киоск стоит тёмным после каждого обновления и смены сети.
function _shutdown() {
    try { selfCheck.stop(); }      catch (e) { console.error('[stop] diag:', e.message); }
    try { serialSource.stop(); }   catch (e) { console.error('[stop] serial:', e.message); }
    try { streamManager.stopAll(); } catch (e) { console.error('[stop] streams:', e.message); }
    process.exit(0);
}
process.on('SIGTERM', _shutdown);
process.on('SIGINT',  _shutdown);

module.exports = {
    Start : Start
}
///Проверка обновления версия 1.1.3