const _port = process.env.PORT || 80;
var _server = require("./server/server");


_server.Start(_port);