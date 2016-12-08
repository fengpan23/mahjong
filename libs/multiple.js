"use strict";
const _ = require('underscore');
const config = require('../config/mahjong');
const M = config.card;
const points = config.points;

/**
 * test is win two side
 * @param cards   已包括discard
 * @param discard
 * @returns {boolean}
 */
function winTwo(cards, discard){
    let links = tubeLink(cards);
    for(let link of links){
        let i = link.indexOf(discard);
        if(~i){
            let num = +discard.split('')[1];
            if(i === 0 && num < 8 || i === 2 && num > 3){
                return true;
            }
        }
    }
    return false;
}

/**
 * three link
 * @param tCards    tong cards
 */
function tubeLink(tCards){
    let c = _.clone(tCards), double = [];

    for (let i = 0; i < c.length - 1; i++) {
        if(c[i] === c[i+1])double.push(c[i]);
    }
    for(let db of double){
        let cards = _.clone(c);
        let i = _.indexOf(cards, db);
        let d = cards.splice(i, 2);

        let three = link(cards);
        if(three){
            three.push(d);
            return three;
        }
    }
    function link(ca){
        let three = [];
        for (let i = 0; i < ca.length; i++) {
            let sp = ca[i].split('');
            let cai1 = _.indexOf(ca, sp[0] + (+sp[1] + 1));
            let cai2 = _.indexOf(ca, sp[0] + (+sp[1] + 2));
            if (cai1 > -1 && cai2 > -1) {
                three.push([ca[i], ca[cai1], ca[cai2]]);
                ca.splice(cai2, 1);
                ca.splice(cai1, 1);
                ca.splice(i, 1);
                i--;
            }
        }
        return ca.length === 0 ? three : false;
    }
}

let type = {
    burst: {
        /**
         * 十八罗汉
         * @param cards
         */
        fourQuads: function (cards) {
            let double = false;
            for(let i in cards){
                if(cards[i].length === 2 && !double){
                    double = true;
                    continue;
                }
                if(cards[i].length !== 4)return false;
            }
            return double && _.size(cards) === 4;
        },

        /**
         * 全字
         * @param cards
         */
        allFont: function (cards) {
            for (let i in cards) {
                if (i.indexOf('D') > -1)return false;
            }
            return true;
        },

        /**
         * 大四喜
         * @param cards
         */
        bigFour: function (cards) {
            let members = ['W1', 'W2', 'W3', 'W4'];
            for(let m of members){
                if(!cards[m] || cards[m].length < 3)return false;
            }
            return true;
        },

        /**
         * 小四喜
         * @param cards
         */
        smallFour: function (cards) {
            let members = ['W1', 'W2', 'W3', 'W4'];
            let double = false;
            for(let m of members){
                if(cards[m] && cards[m].length > 2){

                }else if(!double && cards[m] && cards[m].length === 2){
                    double = true;
                }else{
                    return false;
                }
            }
            return true;
        },

        /**
         * 大三元
         * @param cards
         */
        bigThree: function (cards) {
            let members = ['S1', 'S2', 'S3'];
            for(let m of members){
                if(!cards[m] || cards[m].length < 3)return false;
            }
            return true;
        }
    },

    /**
     * 四暗刻
     * @param hCards  hand cards
     */
    fourDark: function (hCards) {
        //TODO: 必须得自摸
        //TODO: 允许暗杠
        let cards = _.groupBy(hCards), double = false;
        for (let i in cards) {
            if(cards[i].length === 3)continue;
            if(cards[i].length === 2 && !double){
                double = true;
                continue;
            }
            return false;
        }
        return _.size(cards) === 5;
    },

    /**
     * 小三元
     * @param cards
     */
    smallThree: function (cards) {
        let members = ['S1', 'S2', 'S3'];
        let double = false;
        for(let m of members){
            if(cards[m] && cards[m].length > 2){

            }else if(!double && cards[m] && cards[m].length === 2){
                double = true;
            }else{
                return false;
            }
        }
        return true;
    },

    /**
     * 碰碰胡
     * @param cards
     */
    allDouble: function (cards) {
        let double = false;
        for (let i in cards) {
            if (!double && cards[i].length === 2){
                double = true;
                continue;
            }
            if(cards[i].length < 3)return false;
        }
        return true;
    },

    /**
     * 一筒/九筒/字牌（碰碰胡） - 4番
     * @param cards
     */
    specDouble: function (cards) {
        for(let i in cards){
            if(~cards[i].indexOf('D')){
                if(!~['D1', 'D9'].indexOf(cards[i]))return false;
            }
        }
        return true;
    },

    allTong: function(cards){
        for(let i in cards){
            if(!~i.indexOf('D'))return false;
        }
        return true;
    },

    /**
     * 四飞
     * @param cards     all of player cards
     * @returns {boolean}
     */
    fourJoker: function (cards) {
        let c = _.groupBy(_.flatten(cards));
        return c['A1'] && c['A1'].length === 4;
    }
};

/**
 * get font cards fan(字牌（单独）算番)
 *
 * 三只 or  四只
 * 东：东风拿到算2番，南风或西风拿到算1番
 * 南：只有南风拿到算1番
 * 西：只有西风拿到算1番
 * 北：1番（东风，南方，西风）
 * 中：1番（东风，南方，西风）
 * 发：1番（东风，南方，西风）
 * 白：1番（东风，南方，西风）
 *
 * @param fCards    font cards
 * @param dir       direction ["south" | "west" | "east"]
 * @param omit      omit
 */
function font(fCards, dir, omit) {
    let three = _.difference(["W4", "S1", "S2", "S3"], omit), fontMap = {east: 'W1', south: 'W2', west: 'W3', north: 'W4', red: 'S1', green: 'S2', white: 'S3'}, invertMap = _.invert(fontMap);
    let type = [], fan = 0;
    for(let key in fCards){
        let len = Math.floor(fCards[key].length / 3);
        if(!len)continue;

        if(~three.indexOf(key)){
            _.times(len, () => {
                fan += 1;
                type.push(points[invertMap[key]]);
            });
            continue;
        }
        let d = fontMap[dir] === key;
        switch (key){
            case 'W1':
                let f = d ? 2 : 1;
                let p = points[invertMap['W1']];
                p.fan = f;
                _.times(len, () => {
                    fan += f;
                    type.push(p)
                });
                break;
            case 'W2':
            case 'W3':
                d && _.times(len, () => {
                    fan += points[invertMap[key]].fan;
                    type.push(points[invertMap[key]])
                });
                break;
        }
    }
    return {fan: fan, type: type};
}

/**
 * get flower cards fan(花牌算番)
 *
 * 春：只有东风拿到算1番, 夏：只有南风拿到算1番, 秋：只有西风拿到算1番, 冬：1番（东风，南方，西风）
 * 梅：只有东风拿到算1番, 兰：只有南风拿到算1番, 竹：只有西风拿到算1番, 菊：1番（东风，南方，西风）
 * 猫：1番（东风，南方，西风）, 鼠：1番（东风，南方，西风）, 鸡：1番（东风，南方，西风）, 蜈蚣：1番（东风，南方，西风）
 * 人头：1番（东风，南方，西风）, 飞：1番（东风，南方，西风）
 *
 * @param fCards    flower cards 花牌
 * @param dir       direction 方位 ["south" | "west" | "east"]
 */
function flower(fCards, dir) {
    let flowerCards = _.union(Object.keys(M['flower'].cards), Object.keys(M['person'].cards), Object.keys(M['joker'].cards));
    let dirFace = {east: ['F1', 'F5'], south: ['F2', 'F6'], west: ['F3', 'F7']};
    let omit = _.omit(dirFace, dir);
    for(let key in omit){
        flowerCards = _.difference(flowerCards, omit[key]);
    }
    let fan = 0;
    fCards.forEach(function (card) {
        ~flowerCards.indexOf(card) && fan++
    });

    let p = points['flower'];
    p.fan = fan;
    return p;
}

/**
 * 转换明牌中的飞
 * @param cards
 * @returns {Array}
 */
function map(cards){
    let mCards = [];
    cards && cards.forEach(function (c) {
        let i = c.indexOf('A1');
        if (!~i) {
            mCards.push(c);
        } else if (i === 0) {
            mCards.push([c[1][0] + (+c[1][1] - 1), c[1], c[2]]);
        } else if (i === 1) {
            mCards.push([c[0], c[0][0] + (+c[0][1] + 1), c[2]]);
        } else if (i === 2) {
            let inc = c[0] === c[1] ? 0 : 1;
            mCards.push([c[0], c[1], c[1][0] + (+c[1][1] + inc)]);
        } else {
            console.error('map bright cards error !!! ', c);
        }
    });
    return mCards;
}

/**
 * @param comb    {wCards: [], map: []}
 * @param bCards    bright cards    明牌（吃，碰， 杠（暗杠） 含飞）
 * @param addition
 *      {   gCard: string       get card        摸到的牌    //in hCards
 *          discard: string     discard         别人打的牌
 *          fCards: array       flower cards    花牌
 *          dir: string         direction       玩家方位（东南西）
 *          kWin: boolean       kong win        杠上胡
 *          fWin: boolean       flower win      花上胡
 *          robWin: boolean     rob kong win    抢杠胡
 *          godwin: boolean     god win         天胡
 *          dieWin: boolean     die win         地胡
 *          fourJoker: boolean   jacks win       四飞胡
 *      }
 *   找到爆胡  直接结束返回
 * @return {Object} {fan: total fan, type: [{fan: number, cn: name}, ...]}
 */
function fan(comb, bCards, addition){
    let mul = {fan: 0, type: []};
    let hCards = _.without(_.flatten(comb.wCards), 'A1').concat(comb.map).filter(Boolean);
    let tCards = _.compact(hCards.concat(_.flatten(map(bCards)))).sort();
    let gCard = _.groupBy(tCards);

    if(comb.jwin){
        mul.fan = points['god_fourJoker'].fan;
        mul.type.push(points['god_fourJoker']);
        return mul;
    }

    for(let w of ['godwin', 'dieWin']){
        if(addition[w]) {
            mul.fan = points[w].fan;
            mul.type.push(points[w]);
            return mul;
        }
    }

    if(type.fourJoker(comb.wCards.concat(bCards, addition.fCards))){
        mul.fan = points['jokerWin'].fan;
        mul.type.push(points['jokerWin']);
        return mul;
    }

    if(addition.fCards.length === 0){
        mul.fan += points['clean'].fan;
        mul.type.push(points['clean']);
        return mul;
    }

    let name;
    for(let t in type.burst) {
        if(type.burst[t](gCard)){
            if(t === 'allFont'){
                name = t;
                continue;
            }
            name = name ? name + '_' + t : t;
            break;
        }
    }
    if(name){
        mul.fan += points[name].fan;
        mul.type.push(points[name]);
        return mul;
    }

    if(type.fourDark(hCards)){
        mul.fan += points['fourDark'].fan;
        mul.type.push(points['fourDark']);
        return mul;
    }

    let omit = [];
    if(type.allTong(gCard)){
        let tong = points['allTong'];
        if(type.allDouble(gCard)){
            mul.fan += tong['double'].fan;
            mul.type.push(tong['double']);
        }else if(tubeLink(tCards)){
            if(addition.discard){
               if(winTwo(tCards, addition.discard)){
                   mul.fan += tong['three'].fan;
                   mul.type.push(tong['three']);
               }else{
                   mul.fan += tong['other'].fan;
                   mul.type.push(tong['other']);
               }
            }else{
                mul.fan += tong['three'].fan;
                mul.type.push(tong['three']);
            }
        }else{
            mul.fan += tong['other'].fan;
            mul.type.push(tong['other']);
        }
    }else{
        if(type.allDouble(gCard)){
            if(type.specDouble(tCards)){
                mul.fan += points['19double'].fan;
                mul.type.push(points['19double']);
            }else{
                mul.fan += points['allDouble'].fan;
                mul.type.push(points['allDouble']);
            }
        }
        if(type.smallThree(gCard)){
            omit = ['S1', 'S2', 'S3'];
            mul.fan += points['smallThree'].fan;
            mul.type.push(points['smallThree']);
        }
    }

    let fonts = _.omit(gCard, (v, k) => {return !k.indexOf('D')});
    let fontFan = font(fonts, addition.dir, omit);
    if(fontFan.fan > 0) {
        mul.fan += fontFan.fan;
        mul.type = mul.type.concat(fontFan.type);
    }

    let flowerFan = flower(_.flatten(addition.fCards), addition.dir);
    mul.fan += flowerFan.fan;
    mul.type.push(flowerFan);

    for(let w of ['fWin', 'kWin', 'robWin']){
        if(addition[w]){
            mul.fan += points[w].fan;
            mul.type.push(points[w]);
            break;
        }
    }
    mul.fan += 1;
    mul.type.push(points['win']);
    return mul;
}

module.exports = fan;

//test
if (require.main !== module) return;

// let hCards = [ 'D2', 'D2', 'D3','D4', 'D5', 'D6', 'D7', 'D8'];
// let hCards = ['S1', 'S1', 'S1', 'S2', 'S2', 'S2', 'S3', 'S3', 'S3', 'D2', 'D2'];
let hCards = ['W1', 'W1', 'W2', 'W2', 'W2', 'W3', 'W3', 'W3', 'W4', 'W4', 'W4'];   //小四喜

let bCards = ['W1', 'W1' , 'W1'];
let addition = {gCard: 'D4', fCards: [ [ 'A6', 'F2', 'A8' ], [ 'A2' ], [ 'A3' ], [ 'A1' ], [ 'F5' ] ], dir: 'south' };
console.log(fan({wCards: hCards}, bCards, addition));