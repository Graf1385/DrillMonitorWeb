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

module.exports = { addClient, removeClient, broadcast };
