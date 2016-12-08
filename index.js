"use strict";
const _ = require('underscore');
const async = require('async');
const Handle = require('./libs/handle');
const Round = require('./module/round');
const Game = require('./module/game');
const Timeout = require('./config/timeout.json');

const Log = require('log')({env: 'develop', singleton: true});   //create singleton log
const Server = require('server');

class Index {
    constructor() {
        this._server = new Server({tableId: 270, api: this});

        this._deposit = this._server.getModule('deposit');

        let handleKong = (player, result) => {      // bKong(暗杠) or wKong(明杠)
            let req = this._server.createRequest(player, 'kong');
            this._kong(player, result).then(k => {
                req.response('game', k.r);
                req.broadcast('game', k.b);
                req.once('afterClose', () => {
                    this._draw({sid: player.index, repair: true, kWin: true});  //如果有补花，去除杠上胡. -> 花上胡
                });
                req.close();
            }).catch(error => req.error('unexpected_error', error));
        };

        Round.on('timeout', (sid, action) => {
            Log.info('sid: ', sid, ' timeout action: ', action);
            if(Game.over())return this._over();

            let player = this._server.getPlayers({index: sid}), params = {auto: true};
            if(action === 'discard')
                params.discard = player.get('hCards').slice(-1)[0];

            this[action](this._server.createRequest(player, action, params), player);
        }).on('auto', index => {
            let player = this._server.getPlayers({index: index});
            this._server.broadcast('userstate', {game: {seatindex: index, state: player.set('state', -1)}});
        }).on('selfDo', result => {
            //Log.info('self do result: ', result);
            let players = this._server.players;
            let player = this._server.getPlayers({index: result.sid});
            switch (result.action) {
                case 'win':
                    this._win(result, {selfDrawn: true});
                    break;
                case 'wKong':    //明杠， 判断其它玩家是否可以胡（抢杠胡）
                    Round.discard(result.sid, result.cards[0]).once('declared', res => {
                        if (res.action === 'win')
                            return this._win(res, {kWin: result.sid});
                        player.set('hCards', Handle.doAction(player.get('hCards'), result.cards[0]));
                        handleKong(player, result);
                    });
                    players.forEach(player => {
                        if (player.index === result.sid) return;

                        let options = _.extend({
                            discard: result.cards[0],
                            dir: Game.getDir(player.index),
                            robWin: true,
                            omit: ['chow', 'pong', 'kong']
                        }, player.get('hCards', 'bCards', 'fCards'));
                        let operate = Game.operate(options);
                        if (operate && operate.win) {
                            let request = this._server.createRequest(player, 'operate');
                            request.response('game', {win: operate.win});
                            request.once('afterClose', () =>{
                                operate.win.cando && Round.setAction(player.index, ['win']).startTimer(player.index);
                                //TODO: fix can't do
                            });
                            request.close();
                        } else {
                            Round.declare(player.index, 'pass');
                        }
                    });
                    break;
                case 'bKong':
                    player.set('hCards', Handle.doAction(player.get('hCards'), result.cards));
                    handleKong(player, result);
                    break;
            }
        });
    }

    init(request) {
        Log.info('... api init ...');
        let player = _.find(this._server.players, p => p.clientId === request.clientId);
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
    }

    userjoin(request, player) {
        Log.info('... api user join ....');

        let table = this._server.get('table');
        let min = table.minbuy || table.minbet * (20 * 4 + 10);
        let point = player.get('point');
        if (point < min)
            return request.error('insufficient_fund', point);

        this._deposit.buy(player, min).then(balance => {
            return this._server.seat(player).then(seatIndex => {
                let user = {
                    kid: player.id,
                    name: player.username,
                    point: balance,
                    seatindex: seatIndex,
                    state: 1
                    // readytimeout: Timeout.ready
                };

                let players = {};
                this._server.players.forEach(p => {
                    if(p.id !== player.id){
                        players[p.index] = {
                            name: p.username,
                            point: p.balance,
                            state: 1,
                            seatindex: p.index
                        }
                    }
                });

                request.response('user', user);
                request.response('players', players);
                request.broadcast('user', user);
                request.once('afterClose', () => {
                    // game.join(sid);
                    // if(this._server.players.size === table.maxkiosk);
                    if (this._server.getPlayers('seat').length === 3)
                        this._start();
                });
                // timer.start(Timeout.ready, null, '' + sid);
                request.close();
            });
        }).catch(e => {
            Log.error('user seat error: ', e);
            request.error(e.code, e.message);
        });
    }

    /**
     * api user state(玩家状态)
     * @param request
     * @param player
     */
    userstate(request, player) {
        let state = player.get('state');
        if(player.get('state') > 0)return request.close();

        let startTimeout = 0;
        switch (state){
            case -1:
                Round.setTimer(player.index, -1);
                player.set('state', 3);
                break;
            case 0:
                // timer.clear('' + sid);
                request.once('afterClose', () => {
                    Game.ready(sid);
                    Game.canStart() && this._start();
                });
                //need test(for restart user state)
                // for(let t in timer.timermap){
                //     if(t.indexOf('ready_') > -1){
                //         startTimeout = timer.timermap[t].countdown;
                //         break;
                //     }
                // }
                player.set('state', 1);
                break;
        }
        this._server.broadcast('userstate', {game: {seatindex: player.index, state: player.get('state'), starttimeout: startTimeout}});
        request.close();
    }

    _start() {
        Log.info('... game start ...');
        this._server.open({retry: 3}).then(() => {
            let dies = Handle.throwDie(3);      //throw 3 die
            let dirMap = Game.randomEast(dies[0]);    //get east
            let sta = dies[1] + dies[2];

            Game.shuffle();         //new game shuffle cards
            this._dealCards(sta, {die: Handle.dealDie(dies), dirmap: dirMap, actionseatindex: Game.getIndex('east'), actiontimeout: Timeout.discard});
        }).catch(e => {
            Log.error('game open error !', e);
        });
    }

    /**
     * deal cards(发牌)
     * @param sta  start get cards index
     * @param die
     * @private
     */
    _dealCards(sta, die){
        Log.info('... deal cards ...');
        let r = {}, b = {}, actions = ['discard'], f = 0;
        let players = this._server.players;
        players.sort((a, b) => Game.huge(a.index) - Game.huge(b.index));

        players.forEach((player, i) => {
            let res = {}, boc = {};
            let num = Game.isEast(player.index) ? 14 : 13;
            let repaired = Game.repairCard(Game.dealCard(num, false, sta));     //deal card =>//repair flower // sort
            player.set('hCards', res.hcards = repaired.cards);
            player.set('fCards', res.fcards = repaired.fcards);
            player.set('bCards', []);
            res.repaired = repaired.repaired;

            f += res.fcards.length || 0;

            let options = _.extend({dir: Game.getDir(player.index), jokerWin: true}, player.get(['hCards', 'fCards']));
            let operate;
            if(Game.isEast(player.index)){
                options.godWin = true;
                operate = Game.operate(options);
                if(operate && !operate.win){
                    res.operate = operate;
                    actions = actions.concat(Object.keys(operate))
                }
            }else{
                options.omit = ['kong'];
                operate = Game.operate(options);
            }
            if(operate && operate.win)player.set('win', true);

            boc.hcardnumber = res.hcards.length;
            boc.fcards = res.fcards;    //use two-dimensional array（二位数组）
            boc.tcards = res.tcards = Game.getTableCards(i === 2);

            r[player.index] = res;
            b[player.index] = boc;
        });

        let win = false;
        players.forEach(player => {
            let request = this._server.createRequest(player, 'dealcard'), sid = player.index;
            if(!win && player.get('win')){
                win = true;
                request.once('afterClose', () => {
                    setTimeout(() => {              //start god win and four joker win timer
                        this._win({sid: sid}, {selfDrawn: true});
                    }, Timeout.start * 1000);
                });
            }else if(Game.isEast(sid)) {
                request.once('afterClose', () => {
                    let t = Timeout.discard + Timeout.start + Timeout.repair * f;
                    Round.setAction(sid, actions).setTimer(sid, t).startTimer(sid);
                });
            }
            request.response("game", {start: die, our: r[player.index], others: _.omit(b, player.index)});
            request.close();
        });
    }

    /**
     * draw cards（抓牌或补牌）
     * @param opt.sid   seat index
     * @param opt.kWin  boolean
     * @param opt.card  String
     * @param opt.repair boolean
     * @param opt.time number
     * @private
     */
    _draw(opt){
        let player = _.findWhere(this._server.players, {index: opt.sid});
        let req = this._server.createRequest(player, 'draw');
        let repair = Game.repairCard(Game.dealCard(1, opt.repair));     //get card
        let b = {}, r = {}, arr = [], draw = {flyinbcards: -1, lastnormal: true, reason: 0}, options = {};

        if(opt.card){       //出花牌（A1）
            arr.push(opt.card);
            draw.reason = 1;
            player.get('fCards').push([opt.card]);
        }
        options.kWin = opt.kWin && (draw.reason = 2);

        if (repair.fcards.length > 0){  //有补花
            options.fwin = true;        //win after get flower
            arr = arr.concat(_.flatten(repair.fcards));
            player.set('fCards', player.get('fCards').concat(repair.fcards))
        }
        options.gCard = repair.cards[0];

        let takeOff = false;
        player.get('bCards').forEach((bc, i) => {
            if(bc[2] === 'A1' && bc[0] === bc[1] && repair.cards[0] === bc[0]){  //take off（起飞）
                bc[2] = repair.cards[0];
                options.gCard = 'A1';
                draw.flyinbcards = i;
                takeOff = true;
            }
        });

        _.extend(options, {dir: Game.getDir(opt.sid)}, player.get('hCards', 'bCards', 'fCards'));

        if(Game.over())
            options.omit = true;
        let actions = ['discard'], operate = Game.operate(options);     //player can do.

        if (operate){
            actions = actions.concat(Object.keys(operate).map(a => a.toLowerCase()));
            if (operate.win && !operate.win.cando) {
                actions = _.without(actions, 'win');     //exclude can't win operate
            }
            r.operate = operate;
        }

        let _arr = _.clone(arr);
        if(repair.cards[0]){        //正常拿到牌
            player.get('hCards').push(takeOff ? 'A1' : repair.cards[0]);
            arr.push(repair.cards[0]);
            _arr.push('');
        }else{
            draw.lastnormal = false;
        }

        b.draw = Object.assign({}, draw);
        b.draw.cards = _arr;
        r.draw = Object.assign({}, draw);
        r.draw.cards = arr;

        b.hcardnumber = player.get('hCards').length;
        r.tcards = b.tcards = Game.getTableCards();
        r.fcards = b.fcards = player.get('fCards');
        r.bcards = b.bcards = player.get('bCards');

        r.actiontimeout = b.actiontimeout = Timeout.discard;
        b.actionseatindex = player.index;

        req.response('game', r);
        req.broadcast('game', b);
        req.once('afterClose', () => {
            let t = Timeout.repair * ((arr.length || 1) - 1) + 0.75;
            if(opt.time){
                let mist = new Date() - opt.time;
                t += mist > 800 ?  0.8 : 0.8 + mist/1000;
            }
            takeOff && (t += 0.73);     //take off time 0.73 s
            if (Game.over()){
                if(actions.indexOf('win') < 0)
                    return setTimeout(this._over.bind(this), t * 1000);
                actions = ['win'];
            }
            t += ~player.get('state') ? Timeout.discard : Timeout.auto;
            Round.setAction(player.index, actions, true).setTimer(player.index, t).startTimer(player.index);  //set action and start timer
        });
        req.close();
    }

    /**
     * do win
     * @param result
     * @param options   {Object}    {fire: sid}
     * @private
     */
    _win(result, options){
        Log.info('do win params result and options ', result, options);
        let players = this._server.players, broData = {};
        broData.hcards = {};
        players.forEach(p => broData.hcards[p.index] = p.get('hCards'));

        let info = broData.wininfo = Game.getWin(result.sid);
        this._point(Game.winBill(result, options, info)).then(res => {
            Log.info('do point results: ', result);

            broData.wininfo = Game.getWin(result.sid);
            broData.user = res;
            broData.readytimeout = Timeout.ready;
            broData.actionseatindex = result.sid;
            this._server.broadcast('win', {game: broData});
            this._over(true);
        }).catch(error => Log.error('do_win_point_error', error));
    }

    /**
     * do kong
     * @private
     * @param player
     * @param result
     * @returns  {Object}   {r: Object, b: Object}
     */
    _kong(player, result){
        Log.info('do kong result params: ', result);
        let bCards = player.get('bCards');

        return this._point(Game.kongBill(result, bCards)).then(result => {
            //console.info('kong do point result: ', result);
            let r = {}, b = {};
            r.bcards = b.bcards = bCards;
            r.hcards = player.get('hCards');
            b.hcardnumber = r.hcards.length;
            b.actiontimeout = r.actiontimeout = Timeout.action;
            b.actionseatindex = player.index;
            r.user = b.user = result;
            return Promise.resolve({r: r, b: b});
        });
    }

    _over(win){
        Log.info('game over win: ', win);
        let players = this._server.players;
        if(!win){       //broadcast no win game cards
            let bGame = {};
            bGame.readytimeout = Timeout.ready;
            bGame.hcards = {};
            players.forEach(player => bGame.hcards[player.seatindex] = player.get('hCards'));
            setTimeout(() => {
                this._server.broadcast('win', {game: bGame});
            }, 2000);
        }

       this._server.close().then(() => {
            Round.over();
            Game.over(null, true);

            players.forEach(player => {
                if (~player.get('state')) {
                    player.clear();
                    Game.join(player.index);
                } else {
                    this._server.quit(player);
                }
            });
           return Promise.resolve();
        }).catch(e => {
            Log.error('do server close error', e);
            this._server.exit();
        });
    }

    /**
     * do point
     * @param bills 输赢[{sid: point}, {sid: -point}]
     * @private
     */
    _point(bills){
        Log.info('do point bills : ', bills);
        bills.sort((a, b) => a.fan - b.fan);     //do lose before do win(先做输钱 后做赢钱)
        return new Promise((resolve, reject) => {
            let table = this._server.get('table'), result = {};
            async.forEachOfSeries(bills, (bill, key, callback) => {
                let _do = bill.fan > 0 ? 'win' : 'bet';
                let player = this._server.getPlayers({index: bill.sid});
                let point = table.minbet * bill.fan;

                this._deposit[_do](player, point).then(res => {
                    Log.debug(player.index + ' do ' + _do + ' res => ' + res);

                    result[bill.sid] = {point: player.balance, win: point};
                    callback();
                });
            }, err => {
                if(err)return reject(err);
                resolve(result);
            });
        });
    }

    /**
     * api discard（出牌-> 玩家表态）
     */
    discard(request, player) {
        let sid = player.index, card = request.getParams('content.discard'), time = +new Date();

        Log.info('seat index: ', sid, ' discard: ', card);

        if (!Round.verify(sid, 'discard', player.get('hCards'), card))
            return request.close();
        //console.info('seat index: ', sid, ' verify success !!!');
        Round.state(sid, request.getParams('content.auto'));

        let players = this._server.players, r = {discard: card}, g = {discard: card, seatindex: sid};

        r.hcards = player.set('hCards', Handle.doAction(player.get('hCards'), card));   //do discard action
        g.hcardnumber = r.hcards.length;
        if(card === 'A1') {     //discard fly
            Round.discard(sid, card);
            request.once('afterClose', () => this._draw({sid: sid, repair: true, card: card}));
        }else {
            Round.discard(sid, card).once('declared', result => {   //player discard， wait others declare
                Log.info(result.sid + ' best action ', result);
                this._server.broadcast('declared', {game: {seatindex: sid, card: card}});//send discard success mess
                Round.record(result.action);

                if (result.action === 'win')
                    return this._win(result, {fire: sid});
                if (result.action === 'pass')
                    return this._draw(_.extend(result, {time: time}));

                let player = _.findWhere(players, {index: result.sid}), actions, resData = {}, broData = {};
                let req = this._server.createRequest(player, result.action);

                new Promise((resolve, reject) => {
                    switch (result.action) {
                        case 'chow':
                        case 'pong':
                            player.get('bCards').push(result.cards);

                            resData.hcards = player.set('hCards', Handle.doAction(player.get('hCards'), result.cards, card));
                            resData.bcards = broData.bcards =  player.get('bCards');
                            broData.actiontimeout = resData.actiontimeout = Timeout.discard;
                            broData.hcardnumber = resData.hcards.length;

                            actions = ['discard'];
                            resolve();
                            break;
                        case 'kong':    // 碰杠（明杠）
                            player.set('hCards', Handle.doAction(player.get('hCards'), result.cards, card));
                            result.discardid = sid;

                            this._kong(player, result).then(k => {
                                resData = k.r;
                                broData = k.b;
                                resolve();
                            }).catch(reject);
                            break;
                    }
                }).then(() => {
                    broData.actionseatindex = player.index;
                    req.response('game', resData);
                    req.broadcast('game', broData);
                    req.once('afterClose', () => {
                        if(actions){
                            Round.setAction(result.sid, actions, true).setTimer(result.sid, Timeout.discard).startTimer();  //set action and start timer
                        }else{
                            this._draw({sid: result.sid, repair: true, kWin: true});
                        }
                    });
                    req.close();
                }).catch(error => {
                    req.error('unexpected_error', error);
                });
            });

            request.once('afterClose', () => {
                players.map(player => {    //other player can do operate
                    if (player.index === sid)return;
                    let omit = (+(sid + 1).toString(3).slice(-1) + 1) === player.index ? ['chow'] : ''; //pass pre player chow
                    let operate = Game.operate(_.extend({
                        discard: card,
                        omit: omit,
                        dieWin: Round.times() === 1,
                        dir: Game.getDir(player.index)
                    }, player.get(['hCards', 'bCards', 'fCards'])));

                    if (operate) {
                        Log.info('seat index ', player.index, ' can do operate:', operate);
                        let actions = Object.keys(operate).filter(Boolean);
                        if (operate.win && !operate.win.cando)actions = _.without(actions, 'win');
                        operate.actiontimeout = Timeout.action;

                        let req = this._server.createRequest(player, 'operate');
                        req.response('game', operate);
                        req.once('afterClose', () => {
                            if (actions.length > 0) {
                                let t = ~player.get('state') ? Timeout.action : Timeout.auto;
                                Round.setAction(player.index, actions).setTimer(player.index, t).startTimer(player.index);
                            } else {
                                Round.declare(player.index, 'pass');
                            }
                        });
                        req.close();
                    }else{
                        Round.declare(player.index, 'pass');   //no operate,  pass direct
                    }
                });
            });
        }
        request.response('game', r);
        request.broadcast('game', g);
        request.close();
    };

    /**
     * api player win game
     */
    win(request, player) {
        Log.info('seat index ', player.index, ' win ');
        if(Round.verify(player.index, 'win')) {
            if(Handle.win(player.get('hCards'))){     //自摸
                Round.selfDeclare(player.index, 'win');
            }else{
                Round.declare(player.index, 'win');
            }
        }
        request.close();
    }

    /**
     * api player kong
     */
    kong(request, player){
        let cards = request.getParams('content.cards');
        if (!cards)return request.close();

        let card = cards[0];
        Log.info('seat index ', player.index, ' kong ', cards);
        let length = function (cards, card) {
            let len = 0;
            _.flatten(cards).forEach(c => { card === c && len++;});
            return len
        };

        let hCards = player.get('hCards');
        let bCards = player.get('bCards');

        if(Round.verify(player.index, 'kong')) {
            let kongCard = [card, card, card, card];
            if (length(hCards, card) === 3) {    //碰杠（明杠）
                Round.declare(player.index, 'kong', kongCard);
            }else if(length(hCards, card) === 4) {      //自摸杠(暗杠)
                Round.selfDeclare(player.index, 'bKong', kongCard);
            }else if(length(bCards, card) === 3) {     //自摸杠(明杠)
                Round.selfDeclare(player.index, 'wKong', kongCard);
            }else{
                Log.error('some kong error !!!');
            }
        }
        request.close();
    }

    /**
     * api player pong
     */
    pong(request, player) {
        Log.info('... api pong ....');
        let cards = request.getParams('content.cards');
        if (!cards)
            return request.close();

        let hCards = player.get('hCards');
        Log.info('seat index ', player.index, ' pong ', cards);

        if (Round.verify(player.index, 'pong', hCards, cards, true))
            Round.declare(player.index, 'pong', cards);
        request.close();
    }

    /**
     * api player chow
     */
    chow(request, player){
        Log.info('... api chow ....');

        let cards = request.getParams('content.cards');
        if (!cards)
            return request.close();
        Log.info('seat index ', player.index, ' chow ', cards);

        if(cards.length > 2 && Round.verify(player.index, 'chow', player.get('hCards'), cards, true)) {
            Round.declare(player.index, 'chow', cards);
        }
        request.close();
    }

    /**
     * api player choose pass（if no operate, system auto pass）
     */
    pass(request, player){
        Log.info('seat index ', player.index, ' pass ');
        if(Round.verify(player.index, 'pass')) {
            Round.state(player.index, request.getParams('content.auto'));
            Round.declare(player.index, 'pass');
        }
        request.close();
    }

    /**
     * api user quit
     * @param request
     * @param player
     */
    userquit(request, player){
        Log.info('... user quit ...');
        let b = {seatindex: player.index};
        if (Game.state !== 1) {     //game not start, leave player quit
            this._quit(sid).then(() => {
                b.state = 2;
                this._server.broadcast('broadcast_userquit', {game: b});
            }).catch(err => request.error('do_quit_error', err));
        }else{
            Round.state(player.index, 'auto');
            player.set('state', b.state = -1);      //auto keep request alive save quit state
            this._server.broadcast('userstate', {game: b});
        }
        request.close();
    }

    /**
     * api reconnect
     */
    reconnect(request){
        let sid = request.seatindex(), server = this.server;
        Log.info(sid, '.......... reconnect .........');

        let players = server.engine.getplayers(), sync = {users: {}, tcards: game.gettablecards(round.times() === 0), dirmap: game.getdir(), die: handle.dealdie(handle.throwdie())};
        let countdown = round.setTimer(sid, -1);
        countdown && (sync.actiontimeout = countdown);
        players.forEach(cli => {
            let re = round.record(cli.seatindex), s = sync.users[cli.seatindex] = {dcards: re.cards, tasks: re.tasks};
            if(cli.seatindex === sid){
                cli.session.state = 3;
                s.hcards = cli.session.hcards;
            }else{
                s.hcardnumber = cli.session.hcards.length;
            }
            _.extend(s, _.pick(cli.session, 'bCards', 'fcards', 'state'), {
                name: cli.getusername(),
                point: cli.session.point
            });
        });
        request.on('afterClose', () => server.broadcast('userstate', {game: {seatindex: sid, state: 3}}));
        request.respone('sync', sync);
        request.close();
    }

    disconnect(player) {
        Log.info('... api disconnect ...');
        this._server.quit(player).then(p => {
            Log.info('player quit success ' + p.index);
            let data = {index: player.index, state: 2};
            this._server.broadcast('disconnect', {game: data});
        }).catch(e => {
            Log.error('disconnect player quit error: ', e);
        });
    }

    exit(){
        return Promise.resolve();
    }
}
new Index();
