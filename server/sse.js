const _clients = new Set();

function addClient(res) {
    _clients.add(res);
}

function removeClient(res) {
    _clients.delete(res);
}

function broadcast(event, data) {
    const msg = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    _clients.forEach(res => {
        try { res.write(msg); } catch (e) { _clients.delete(res); }
    });
}

// Heartbeat: запись в полуоткрытое соединение рано или поздно вызовет
// close/error и клиент удалится — иначе мёртвые res копятся бесконечно
setInterval(() => {
    _clients.forEach(res => {
        try { res.write(':\n\n'); } catch (e) { _clients.delete(res); }
    });
}, 30000);

module.exports = { addClient, removeClient, broadcast };
