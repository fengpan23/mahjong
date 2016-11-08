"use strict";
const Netclient = require('../../../server/lib/netclient.js');
const common = require('../../../utils/common.js');

var readline = require('readline');

var rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

let tableID = 67, gameID = '1000009', port = 50067;
function dominoClient(session, cb){
    let client = new Netclient();
    client.connect(port);
    client.on('connected', function () {
        client.on('request', function (id, event, data) {
            console.log(`${event}   ${JSON.stringify(data)}\n`);
        });

        client.send(0, "init", {
            tableid : tableID,
            gameid : gameID,
            session : session
        });

        cb(client);
    });
}

new dominoClient('fp', function(client){
    client.send(0, 'userjoin', {seatindex: 3, auto: 1});

    function action(cli){
        rl.question("......userpass, userfollow, useraddbet, userallin, userchange,  userfold.......\n", function(aa) {
            let tt = aa.split(' ');
            let data = {};
            let arr = tt[2] || '';
            if(arr.indexOf('_') > 0)arr = arr.split('_');
            data[tt[1]] = arr;

            cli.send(0, tt[0], data);
            action(cli);
        });
    };
    action(client);
});