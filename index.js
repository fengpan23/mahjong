"use strict";
const _ = require('underscore');
// const handle = require('./libs/handle');
// const round = require('./module/round')();
// const game = require('./module/game')();
const Log = require('log')({env: 'develop', singleton: true});   //create singleton log
const Server = require('server');

class Index {
    constructor() {
        this._server = new Server({tableId: 270, api: this});

        this._deposit = this._server.createModule('deposit');
    };

    init(request) {
        Log.info('... api init ...');
        let player = this._server.players.get(request.clientId);
        this._server.login(player, {session: request.getParams('content.session')}).then(player => {
            let table = this._server.get('table');
            let game = {};
            game.balance = player.get('point');
            game.mustbuy = table.minbuy;
            game.actiontimeout = 15;

            request.response('game', game);
            request.close();
        }).catch(e => {
            Log.error('init error: ', e);
        });
    };

    userjoin(request, player) {
        Log.info('... api user join ....');

        let table = this._server.get('table');
        let min = table.minbuy || table.minbet * (20 * 4 + 10);
        let point = player.get('point');
        if (point < min)
            return request.error('insufficient_fund', point);

        this._deposit.buy(player, min).then(balance => {
            console.log('buy in balance: ', balance);
            return this._server.seat(player).then(seatIndex => {
                let user = {
                    kid: player.id,
                    name: player.username,
                    point: balance,
                    seatindex: seatIndex,
                    state: 1
                    // readytimeout: match.timeout.ready
                };

                request.response('user', user);
                request.broadcast('user', user);
                request.once('afterClose', () => {
                    // game.join(sid);
                    // if(this._server.players.size === table.maxkiosk);
                    if (this._server.players.size === 2)
                        this._start();
                });
                // timer.start(match.timeout.ready, null, '' + sid);
                request.close();
            });
        }).catch(e => {
            Log.error('user seat error: ', e);
            request.error(e.code, e.message);
        });
    };

    _start(){
        this._server.open().then(players => {
            console.log(players);
        }).catch(e => {
            Log.error('game open error !', e);
        });
    }

    /**
     * api player win game
     */
    win(request) {
        let sid = request.seatindex(), hcards = request.propertyget('session').hcards;
        console.info('seat index ', sid, ' win ');

        if(round.verify(sid, 'win')) {
            if(handle.win(hcards)){     //自摸
                round.selfdeclare(sid, 'win');
            }else{
                round.declare(sid, 'win');
            }
        }
        request.close();
    };

    /**
     * api player kong
     */
    kong(request){
        if (!request.validate({cards: 'must'}))return;
        let sid = request.seatindex(), card = request.params.cards[0];
        console.info('seat index ', sid, ' kong ', request.params);
        let length = function (cards, card) {
            let len = 0;
            _.flatten(cards).forEach(c => { card === c && len++;});
            return len
        };

        let hcards = request.propertyget('session').hcards;
        let bcards = request.propertyget('session').bcards;

        if(round.verify(sid, 'kong')) {
            let kongCard = [card, card, card, card];
            if (length(hcards, card) === 3) {    //碰杠（明杠）
                round.declare(sid, 'kong', kongCard);
            }else if(length(hcards, card) === 4) {      //自摸杠(暗杠)
                round.selfdeclare(sid, 'bkong', kongCard);
            }else if(length(bcards, card) === 3) {     //自摸杠(明杠)
                round.selfdeclare(sid, 'wkong', kongCard);
            }else{
                console.error('some kong error !!!');
            }
        }
        request.close();
    };

    /**
     * api player pong
     */
    pong(request) {
        if (!request.validate({cards: 'must'}))return;
        let sid = request.seatindex(), hcards = request.propertyget('session').hcards;
        console.info('seat index ', sid, ' pong ', request.params);

        if(round.verify(sid, 'pong', hcards, request.params.cards, true)){
            round.declare(sid, 'pong', request.params.cards);
        }
        request.close();
    };

    /**
     * api player chow
     */
    chow(request){
        if (!request.validate({cards: 'must'}))return;
        let sid = request.seatindex(), cards = request.params.cards;
        let hcards = request.propertyget('session').hcards;
        console.info('seat index ', sid, ' chow ', request.params);

        if(cards.length > 2 && round.verify(sid, 'chow', hcards, cards, true)) {
            round.declare(sid, 'chow', cards);
        }
        request.close();
    };

    /**
     * api player choose pass（if no operate, system auto pass）
     */
    pass(request){
        let sid = request.seatindex();
        console.info('seat index ', sid, ' pass ');
        if(round.verify(sid, 'pass')) {
            round.state(sid, request.params.auto);
            round.declare(sid, 'pass');
        }
        request.close();
    };

    /**
     * api user quit
     * @param request
     */
    userquit(request){
        let sid =  request.seatindex();
        if (!sid)return;
        console.info(sid, ' ... user quit !!! ...');
        let b = {seatindex: sid};
        request.action = 'quit';
        if (game.state() !== 1) {     //game not start, leave player quit
            this._doquit(sid).then(() => {
                b.state = 2;
                this.server.broadcast('broadcast_userquit', {game: b});
            }).catch(err => request.error('error', 'do quit error', err));
        }else{
            round.state(sid, 'auto');
            request.propertyget('session').state = b.state = -1;   //auto keep request alive save quit state
            this.server.broadcast('userstate', {game: b});
        }
        request.close();
    };

    /**
     * api reconnect
     */
    reconnect(request){
        let sid = request.seatindex(), server = this.server;
        console.info(sid, '.......... reconnect .........');

        let players = server.engine.getplayers(), sync = {users: {}, tcards: game.gettablecards(round.times() === 0), dirmap: game.getdir(), die: handle.dealdie(handle.throwdie())};
        let countdown = round.settimer(sid, -1);
        countdown && (sync.actiontimeout = countdown);
        players.forEach(cli => {
            let re = round.record(cli.seatindex), s = sync.users[cli.seatindex] = {dcards: re.cards, tasks: re.tasks};
            if(cli.seatindex === sid){
                cli.session.state = 3;
                s.hcards = cli.session.hcards;
            }else{
                s.hcardnumber = cli.session.hcards.length;
            }
            _.extend(s, _.pick(cli.session, 'bcards', 'fcards', 'state'), {
                name: cli.getusername(),
                point: cli.session.point
            });
        });
        request.on('afterclose', () => server.broadcast('userstate', {game: {seatindex: sid, state: 3}}));
        request.respone('sync', sync);
        request.close();
    };

    disconnect(player) {
        Log.info('... api disconnect ...');
        this._server.quit(player).then(p => {
            let data = {index: player.index, state: 2};
            this._server.broadcast('disconnect', {game: data});
        }).catch(e => {
            Log.error('disconnect player quit error: ', e);
        });
    };

    exit() {
        console.info('--- mahjong exit ---');
        return Promise.resolve();
    };

    exceptionhandle(err) {
        console.error('exception handle', err);
    };
}
new Index();
