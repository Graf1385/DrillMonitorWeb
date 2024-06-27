var os = require('os');
var set_ip_address = require('set-ip-address');

const networkInterfaces = os.networkInterfaces();
const parList = require('./data/parameters.json');


function getNetworkSettings(){
    var settings ={
        "ip" : '',
        "mask" : '',
        "gateway" : ''
    }

    


}

module.exports = {
    networkInterfaces,
    parList,
    getNetworkSettings
};
