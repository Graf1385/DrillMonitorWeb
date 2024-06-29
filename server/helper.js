var _os = require('os');
var _fs = require('fs');
var _set_ip_address = require('set-ip-address');

const _networkInterfaces = _os.networkInterfaces();
const _parList = require('./data/parameters.json');
const _settings = require('./data/settings.json');


function netMaskToPrefex(mask){
    var numbersStr = mask.split('.');
    var count = 0;
    numbersStr.forEach(element => {
        var dec = Number.parseInt(element);
        var bin = (dec >>> 0).toString(2)
        if(dec > 0)
            count += bin.match(/[1]/g).length;
        
    });   
    return count;
}

function getSettings(){
    _settings.ip = _networkInterfaces.eth0[0].address;
    _settings.mask = _networkInterfaces.eth0[0].netmask;
    return _settings;
}

function saveSettings(settings){

    var prefex = netMaskToPrefex(settings.mask);
    var ip = settings.ip;

    eth0 = {
        interface : "eth0",
        ip_address : ip,
        prefix : prefex
    }

    _set_ip_address.configure([eth0]).then(() => console.log('Ошибка изменений сетивых настроек'));

    _fs.writeFileSync('./server/data/settings.json', JSON.stringify(settings), (error) => {
        console.log(error);
    });   
   
}

module.exports = {
    network : _networkInterfaces,
    parlist : _parList,
    getSettings,
    saveSettings
};
