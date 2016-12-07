"use strict";
const _ = require('underscore');
const Handle = require('../libs/handle');
const Multiple = require('../libs/multiple');

const config = require('../config/mahjong');
const M = config.card;

const DIR_LIST = ['east', 'south', 'west'];

function fan(combs, bCards, addition){
    let order = [];
    combs.forEach(function (comb, i) {
        let f = {index: i};
        _.extend(f, Multiple(comb, bCards, addition));
        order.push(f);
    });
    order.sort((a, b) => {return b.fan - a.fan});
    return _.extend(order[0], combs[order[0].index]);
}

class Game {
    constructor() {
        this._seatMap = new Map();
        this._cards = ['A1', 'D1', 'D2'];
        this._winMap = new Map();
        this._flag = -1;    //游戏状态 (-1: init, 0: game over, 1: game ing)
    };

    get state(){
        return this._flag;
    }

    /**
     * 根据东南西排序
     * @param sid
     * @returns {number}
     */
    huge(sid){
        return DIR_LIST.indexOf(this._seatMap.get(sid));
    };

    /**
    * 玩家加入
    * @param sid
    */
    join(sid){
        this._seatMap.set(sid, 'join');
    };

    /**
     * 玩家准备
     * @param sid
     */
    ready(sid){
        this._seatMap.set(sid, 'ready');
    };

    /**
     * 玩家离开
     * @param sid
     */
    leave(sid){
        this._seatMap.delete(sid);
    };

    /**
     * 判断是否庄家
     * @param sid
     * @returns {boolean}
     */
    isEast(sid){
        return this._seatMap.get(sid) === 'east';
    };

    /**
     * 根据玩家方位  获取座位id
     * @param str
     * @returns {*}
     */
    getIndex(str){
        for(let s of this._seatMap){
            if(str === s[1])return s[0];
        }
    };

    /**
     * 设置游戏结束， 获取游戏是否结束
     * @param flag
     * @param clear
     * @returns {*}
     */
    over(flag, clear){
        if(flag)return this._flag = 0;
        if(clear){
            this._seatMap.clear();
            this._winMap.clear();
            this._flag = -1;
        }
        return this._flag === 0;
    };

    /**
     *  获得玩家方位
     */
    getDir(sid){
        if(sid)
            return this._seatMap.get(sid);
        return _.object([...this._seatMap]);
    };

    /**
     * 获取胡牌番数类型
     * @param sid
     * @returns {V}
     */
    getWin(sid){
        return this._winMap.get(this.getDir(sid));
    };

    /**
     * 随机选出庄家
     * @returns {*}
     */
    randomEast(die){
        let eastIndex = die % 3 || 3;
        this._seatMap.set(eastIndex, DIR_LIST[0]);

        for(let i = 1; i < 3; i++) {
            ++eastIndex;
            if (eastIndex === 4)eastIndex = 1;
            this._seatMap.set(eastIndex, DIR_LIST[i]);
        }
        return _.object([...this._seatMap]);
    };

    /**
     * 玩家都准备，开始游戏
     * @returns {boolean}
     */
    canStart(){
        if(this._seatMap.size === 3){
            for(let sp of this._seatMap.values()){
                if(sp !== 'ready')return false;
            }
            this._flag = 1;
            return true;
        }
        return false;
    };

    /**
     * 洗牌
     * @returns *
     */
    shuffle() {
        let m = [];
        for(let ma in M){
            for (let i = 0; i < (M[ma].number || 1); i++){
                m = m.concat(Object.keys(M[ma].cards));
            }
        }
        return this._cards = _.shuffle(m);
    };

    /**
     * 发牌， 抓牌， 补牌（倒序）
     * @param len       拿几张牌
     * @param reverse   是否是补牌（倒着拿）
     * @param sta       拿牌的起始位置
     * @returns {Array || null}
     */
    dealCard(len, reverse, sta){
        let dCard = [];
        let tCards = reverse ?　this._cards.reverse() : this._cards;
        this.start = sta ? sta * 2 : this.start || 0;
        len = len || 1;
        for(let i = 0; i < tCards.length; i++){
            if(tCards[i]){
                dCard.push(tCards[i]);
                tCards[i] = 0;
            }
            if(dCard.length === len){
                reverse && this._cards.reverse();
                return dCard;
            }
        }
        reverse && this._cards.reverse();
        return null;
    };

    /**
     * 补牌
     * @param cards
     * @returns {cards: cards, flower: [], repair: []};
     */
    repairCard(cards) {
        if(!cards){
            this.over(true);
            return {cards: [], fcards: []};
        }
        let flowers = _.union(Object.keys(M['flower'].cards), Object.keys(M['person'].cards));
        if(!config.fly)flowers = flowers.concat(Object.keys(M['joker'].cards));
        let sCards = [], fCards = [], me = this;
        let repObj = { cards: cards, repair: [] };
        function repair(cas) {
            let f = [];
            cas.forEach(card => {
                flowers.indexOf(card) > -1 ?  f.push(card) : sCards.push(card);
            });
            if (f.length > 0) {
                fCards.push(f);
                let repairCard = me.dealCard(f.length, true);
                if(repairCard){
                    repObj.repair.push(repairCard);
                    repair(repairCard);
                }
            }
        }
        repair(cards);
        if(this._cards.filter(Boolean).length === 0)this.over(true);
        return {cards: Handle.sort(sCards), fcards: fCards, repaired: repObj};
    };

    /**
     * 桌子上的牌（公牌）
     * @returns {Array}
     */
    getTableCards(jump){
        let tCard = [];
        for(let i in this._cards){
            let index = (this.start + +i) % this._cards.length;
            tCard[index] = this._cards[i];
            if(jump && this._cards[i]){
                tCard[index - 1] = tCard[index];
                tCard[index] = 0;
                jump = false;
            }
        }

        let t = [], count = 0;

        for(let i = 0; i < tCard.length; i++){
            count += tCard[i] ? 1 : 0;
            if(i % 2){
                t.push(count);
                count = 0;
            }
        }
        return t;
    };

    /**
     * operate 玩家能做的操作， 如果可以胡，加上算番操作
     */
    operate(options) {
        let canDo;
        if (options.discard) {
            canDo = Handle.canDo(options.hCards, options.discard, options.omit);
        }else{
            canDo = Handle.selfCanDo(_.pick(options, 'hCards', 'bCards', 'gCard', 'jokerWin', 'omit')); //首轮四飞 直接胡
        }
        //console.info('operate can do: ', canDo);
        if (canDo.win) {        //if win , get fan
            let addition = _.pick(options, 'gCard', 'discard', 'fCards', 'dir', 'kWin', 'fWin', 'robWin', 'godWin', 'dieWin');
            let bestWin = fan(canDo.win, options.bCards, addition);
            let canWin = bestWin.fan >= 5;
            if (canWin) {
                if (bestWin.fan >= 10)bestWin.fan = 20;
                bestWin.wCards = (options.bcards || []).concat(bestWin.wCards);
                this._winMap.set(options.dir, _.pick(bestWin, 'fan', 'type', 'wCards'));
            }
            canDo.win = _.pick(bestWin, 'fan', 'type');
            canDo.win.cando = canWin;
        }
        return !_.isEmpty(canDo) && canDo;
    };
}

module.exports = new Game();

//test
if (require.main !== module) return;
let g = new Game();
let o = g.operate({gCard: 'W1', hCards: ['D6', 'D6', 'D6', 'D7', 'D7', 'A1', 'D4', 'D4'], bCards: [['W1', 'W1', 'W1'], ['A1', 'D3', 'D3']], fCards: ['A1']});
console.log(o);