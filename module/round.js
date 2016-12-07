"use strict";
const _ = require('underscore');
const Events = require('events');
const Handle = require('../libs/handle');

const Timer = require('timer');
const Timeout = require('../config/timeout.json');

const map = {win: 14, kong: 12, pong: 8, chow: 4, pass: 1};

class Round extends Events{
    constructor() {
        super();
        this._roundMap = [];
        this._discardtTmes = 0;
        this._actionMap = new Map();
        this._timerMap = new Map();  //record user time
        this._stateMap = new Map();  //record user timeout times
        this._record= {};    //record discard

        this._timer = new Timer();
        this._timer.on('stop', (elapsed, countdown, sid) => {
            sid = +sid;
            let type = 'pass';    //get real operate pass or discard`
            let actions = this._actionMap.get(sid);
            if(~actions.indexOf('discard'))type = 'discard';
            this.emit('timeout', sid, type);

            let s = this._stateMap.get(sid) || 0;
            if(s !== 'auto'){
                if(s === 2){
                    this.emit('auto', sid);
                    this._timerMap.set(sid, Timeout.auto);
                    this._stateMap.set(sid, 'auto');
                }else{
                    this._stateMap.set(sid, s + 1);
                }
            }
        });
    };

    state(sid, flag){
        if(flag === 'auto')return this._stateMap.set(sid, 'auto');
        if(!flag){   //not auto declare
            this._stateMap.delete(sid);
        }
    };

    setTimer(sid, time){
        if(~time){
            this._timerMap.set(sid, time);
            return this;
        }else{
            this._timerMap.delete(sid);
            this._stateMap.delete(sid);
            let t = this._timer.get(String(sid));
            if(t && t.countdown > 0){
                return t.countdown;
            }
        }
    };

    /**
     * start timer
     * only have discard and operate timeout
     */
    startTimer(sid){
        if(sid){
            this._timer.start(Math.ceil(this._timerMap.get(sid) || Timeout.discard), null, '' + sid);
        }else {
            for (let id of this._actionMap.keys()) {
                this._timer.start(Math.ceil(this._timerMap.get(id) || Timeout.discard), null, '' + id);
            }
        }
    };

    cleanTimer(sid){
        if(sid){
            this._timer.clear(String(sid), {silent: true});
        }else{
            for (let id of this._actionMap.keys()) {
                this._timer.clear(String(id), {silent: true});
            }
        }
    };

    over(){
        this.cleanTimer();
        this._actionMap.clear();
        this._timerMap.clear();
        this._stateMap.clear();
        this._record= {};
        this._roundMap = [];
        this._dcard = '';
        this._discardtTmes = 0;
        this.removeAllListeners('declared');
    };

    /**
     * set player action
     * @param sid   player seat id
     * @param action player can do action
     * @param clear do clear or not
     */
    setAction(sid, action, clear){
        if(clear){
            this._actionMap.clear();
            this._roundMap = [];
        }
        let actions = this._actionMap.get(sid) || [];
        actions = _.isArray(action) ? actions.concat(action) : actions.push(action);
        this._actionMap.set(sid, actions);
        return this;
    };

    /**
     * verify player action
     * @param sid   player seat id
     * @param action    player action
     * @param cards        use to verify
     * @param vcards    need to verify cards
     * @param omit      to omit discard
     * @returns {boolean}
     */
    verify(sid, action, cards, vcards, omit){
        if(this._actionMap.has(sid) && !_.find(this._roundMap, {sid: sid})){
            let actionArr = this._actionMap.get(sid);
            //console.log(action, ': verify  actionarr', actionarr);
            if(action === 'pass') {
                return _.without(actionArr, 'discard').length > 0;
            }else if(action === 'discard' && !vcards){
                return false;
            }else if(action === 'win'){
                return actionArr.indexOf(action) > -1;
            }else if(~action.indexOf('kong')){
                //TODO need to check kong?
                return true;
            }
            return (actionArr.indexOf(action) > -1) && Handle.doAction(cards, vcards, omit ? this._dcard : '');
        }
        return false;
    };

    /**
     * palyer discard then wait others declare if had
     * @param sid   player seat id
     * @param dCard  player discard
     */
    discard(sid, dCard) {
        this._times += 1;
        this._discardIndex = sid;
        this._dcard = dCard;
        this._roundMap = [];
        this.cleanTimer();
        this._actionMap.clear();
        return this;
    };

    /**
     * record discard times
     * @returns {number}
     */
    times(){
        return this._times;
    };

    /**
     * record discard
     * @param op
     * @returns {*|{cards: Array, tasks: {}}}
     */
    record(op){
        if(_.isNumber(op)){
            return this._record[op] || {cards: [], tasks: {}};
        }
        let mp = this._record[this._discardIndex] || (this._record[this._discardIndex] = {cards: [], tasks: {}});
        mp.cards.push(this._dcard);
        let i = ['chow', 'pong', 'kong'].indexOf(op);
        if(~i){
            mp.tasks[mp.cards.length - 1] = i + 1;
        }
    };

    /**
     * player declare
     * @param sid   player seat id
     * @param action  player action   pass(过)， win(胡)， kong(杠)， pong(碰)， chow(吃)
     * @param cards    action cards
     * return {sid, action}
     */
    declare(sid, action, cards){
        let nid = this._discardIndex % 3 + 1;
        let m = (sid === nid) ? map[action] + 1 : map[action];
        if (action === 'pong' && cards.indexOf('A1') === -1)m += 2;

        this.cleanTimer(sid);
        this._roundMap.push({sid: sid, action: action, cards: cards, map: m});

        //console.log('declare round map: ', this._roundMap);
        if (this._roundMap.length === 2) {  //others(two player) declare
            this._roundMap.sort((a, b) => a.map < b.map);  //get best action
            let dec = _.omit(this._roundMap[0], 'map');
            this.emit('declared', dec);
        }
    };

    selfDeclare(sid, action, cards){
        this.cleanTimer(sid);
        this.emit('selfDo',{sid: sid, action: action, cards: cards});
    };
}

module.exports = new Round();

//test
if (require.main !== module) return;
let r = new Round();

let cc = r.declare();
console.log(cc);