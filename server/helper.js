var os = require('os');
var set_ip_address = require('set-ip-address');

const networkInterfaces = os.networkInterfaces();
const parList = require('./data/parameters.json');
const settings = require('./data/settings.json');


function getSettings(){
    settings.Settings.ip = networkInterfaces.eth0[0].address;
    settings.Settings.mask = networkInterfaces.eth0[0].netmask;
    return settings;
}

module.exports = {
    networkInterfaces,
    parList,
    getSettings
};
