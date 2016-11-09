"use strict";
const Connect = require('connect');
const ReadLine = require('readline');

const rl = ReadLine.createInterface({input: process.stdin, output: process.stdout});

let tableID = 67, gameID = '1000009', port = 50220, session = 13;
class Client{
    constructor() {
        let client = Connect.createClient(port);

        client.on('connected', function () {
            console.log('client connected !!!');
            client.send(0, "init", {tableid: tableID, gameid: gameID, session: session});
            readline(client);
        }).on('init', function (data) {
            console.log('on init: ', data);
            client.send(0, 'seat', {seatindex: 1, auto: 1});
        }).on('seat', function (data) {
            console.log('seat: ', data);
            // client.send(0, 'userjoin', {seatindex: 1, auto: 1});
        }).on('error', error => {
            console.log('client error: ', error);
        }).on('disconnect', () => {
            console.log('client disconnect');
        });

        function readline(cli){
            rl.question(".............\n", function(aa) {
                let tt = aa.split(' ');
                let data = {};
                let arr = tt[2] || '';
                if(arr.indexOf('_') > 0)arr = arr.split('_');
                data[tt[1]] = arr;

                cli.send(0, tt[0], data);
                action(cli);
            });
        }
        client.connect({port: port});
    }
}
new Client();