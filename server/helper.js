var _os = require('os');
var _fs = require('fs');
var _set_ip_address = require('set-ip-address');

const _exec = require('child_process').exec;
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

function rebootSystem(){
    _exec('sudo systemctl restart networking && netplan apply', function(error, stdout, stderr){ (stdout) => {
        Console.log(stdout);
    } });
}

function getSettings(){  
    var netInf = _os.networkInterfaces();
    _settings.ip = netInf.eth0[0].address;
    _settings.mask = netInf.eth0[0].netmask;
    _settings.gateway = netInf.eth0[0].gateway;
    return _settings;
}

function saveSettings(settings){

    var prefex = netMaskToPrefex(settings.mask);

    eth0 = {
        interface : "eth0",
        ip_address : settings.ip,
        prefix : prefex,
        gateway : settings.gateway,
        dhcp: false
    }

    _set_ip_address.configure([eth0]).then(() => console.log('Ошибка изменений сетивых настроек'));

    _fs.writeFileSync('./server/data/settings.json', JSON.stringify(settings), (error) => {
        console.log(error);
        throw error;
    });   

    rebootSystem();
   
}

module.exports = {
    parlist : _parList,
    getSettings,
    saveSettings
};
