require('dotenv').config();
const _port = process.env.PORT || 3000;
var _server = require("./server/server.js");


_server.Start(_port);