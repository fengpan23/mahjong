"use strict";
const _ = require('underscore');
const MAP = {A: 4, D:3, W: 2, S: 1};

function difference(a, b){
    if(a && b){
        let d = [], arr = a.join('_').split('_'), brr = b.join('_').split('_');
        let diff = _.difference(arr, brr);
        diff.forEach(function (i) {
            d.push(i.split(','));
        });
        return d;
    }
    return a;
}

function jackThree(cards, jacks, map){
    if (!cards || cards.length === 0)return [];

    let ca = _.clone(cards), three = [];
    for (let i = 0; i < (cards.length / 3); i++) {
        if ((ca.length > 2) && (ca[0] === ca[1]) && (ca[0] === ca[2])) {
            three.push([ca[0], ca[1], ca[2]]);
            ca.splice(0, 3);
            continue;
        }
        let sp = ca[0].split('');
        let d1 = sp[0] + (+sp[1] + 1), d2 = sp[0] + ((+sp[1] + 2) > 9 ? 7 : (+sp[1] + 2));
        let c1 = _.indexOf(ca, d1), c2 = _.indexOf(ca, d2);

        if (ca[0] === ca[1] && !~c1 && jacks > 0) {
            three.push([ca[0], ca[1], 'A1']);
            map.push(ca[0]);
            ca.splice(0, 2);
            jacks--;
            continue;
        }

        let link = [];
        if (~c2) {
            link[2] = ca.splice(c2, 1)[0];
        } else {
            if (jacks > 0) {
                link[2] = 'A1';
                map.push(d2);
                jacks--;
            } else {
                return false;
            }
        }

        if (~c1) {
            link[1] = ca.splice(c1, 1)[0];
        } else {
            if (jacks > 0) {
                link[1] = 'A1';
                map.push(d1);
                jacks--;
            } else {
                return false;
            }
        }
        link[0] = ca.splice(0, 1)[0];
        three.push(link);
    }
    return ca.length === 0 && three;
}

function fontThree(fcards, jacks, map){
    if(!fcards || fcards.length === 0)return {three: [], jacks: jacks};
    let cards = _.groupBy(fcards), three = [], mend;
    for(let c in cards) {
        mend = (6 - cards[c].length) % 3;
        jacks -= mend;
        if(jacks < 0)return false;

        _.times(mend, () => {
            cards[c].push('A1');
            map.push(cards[c][0]);
        });
        three.push(cards[c].splice(0, 3));
        if(cards.length > 3)three.push(cards[c].splice(3, 3));
    }
    return {three:three, jacks:jacks};
}

var handle = {die: []};

/**
 * show sort  东南西北 中发白
 * @param cards
 * @returns {*}
 */
handle.sort = function (cards) {
    return cards.sort((a, b) => {
        let pa = MAP[a[0]] || a[0];
        let pb = MAP[b[0]] || b[0];
        return pa === pb ? +a[1] - +b[1] : pb - pa;
    });
};

/**
 * throw die
 * @param pcs die number
 */
handle.throwdie = function(pcs){
    if(pcs){
        this.die = [];
        for(let i = 0; i < pcs; i++){
            this.die.push(_.random(1, 6));
        }
    }
    return this.die
};

/**
 * deal die 处理骰子，映射到座位
 * @param die
 * @returns {Array}
 */
handle.dealDie = function (die) {
    let map = [];
    map.push([0, die[0]]);
    let east = die[0] % 3 || 3;
    map.push([east, die[1]]);
    map.push([(east + die[1] - 1) % 3 || 3, die[2]]);
    return map;
};

/**
 * get card  self can do action
 * @param hCards    hand cards
 * @param bCards    bright cards（吃，杠， 碰的牌）
 * @param gcard    get card
 * @returns {win: boolean, kong: Array, bkong: Array}
 */
handle.selfCanDo = function(options){
    let doGroup = {};
    let doCards = options.hCards.concat(options.gcard).filter(Boolean);
    doGroup.win = this.win(doCards.sort(), null, options.jokerwin);
    if(!options.omit){
        doGroup.bkong = this.kong(doCards);     //black kong 暗杠
        if(options.bCards && options.bCards.length > 0){
            options.bCards.forEach(function(b){
                if(b.length === 3 && b[0] === b[1])doCards = doCards.concat(b);
            });
            let w = difference(this.kong(doCards.sort()), doGroup.bkong);   //white kong 明杠
            if(w.length > 0)doGroup.wkong = w;
        }
    }
    return _.omit(doGroup, (value) => !value);
};

/**
 * player discard others can do action
 * @param hCards    hand cards
 * @param discard
 * @returns {win: boolean, kong: array, ...}  (胡 ， 杠 ， 碰， 吃)
 */
handle.canDo = function(hCards, discard, omit){
    let doGroup = {}, me = this;
    let action = _.difference(['win', 'kong', 'pong', 'chow'], omit);
    action.forEach(function (_action) {
        doGroup[_action] = me[_action](hCards, discard);
    });
    return _.omit(doGroup, value => !value);
};

/**
 * do action
 * @param hCards    hand cards
 * @param cards     player choose do cards
 * @param discard
 * @returns {*}
 */
handle.doAction = function(hCards, cards, discard){
    if(!cards)return hCards;
    let tcards = _.clone((_.isArray(cards) ? cards : [cards]));
    let doCards = [];
    let flag = 0;

    discard && tcards.splice(_.indexOf(cards, discard), 1);
    tcards.sort();
    for(let i in hCards){
        if(hCards[i] === tcards[flag] && flag < tcards.length){
            flag++;
            continue;
        }
        doCards.push(hCards[i]);
    }
    return flag === tcards.length ? this.sort(doCards) : false;
};

/**
 * win  1. 先确定对子（将） 2. 字 三连（剩余癞子数） 3. 筒子三连
 * @param hand cards
 * @param discard
 * @returns Array [{wcards: [胡牌组合], map: [飞转换的牌]}]
 */
handle.win = function (hCards, card, jwin) {
    let cards = card ? hCards.concat(card) : hCards;
    let group = _.groupBy(cards.sort(), (c) =>{return c.substr(0, 1);});
    let jacks = group['A'] && group['A'].length || 0, doubles = [];

    if (jwin && jacks === 4) {    //首轮四飞 直接胡
        return [{wcards: [hCards], map: [], jwin: true}];
    }

    for (let i = 0; i < cards.length; i++) {
        if (cards[i] === 'A1')continue;
        if (cards[i] === cards[i + 1]) {
            doubles.push([cards[i], cards[i]]);
            i = _.lastIndexOf(cards, cards[i]);
            continue;
        }
        if (jacks > 0) {
            doubles.push([cards[i], 'A1']);
        }
    }

    let combs = [];
    doubles.forEach(function (double) {
        let j = jacks, map = [];
        let ca = _.clone(cards);
        let index = _.indexOf(ca, double[0]);

        if (double[0] === double[1]) {
            ca.splice(index, 2);
        } else {
            ca.splice(index, 1);
            map.push(double[0]);
            j--;
        }
        if (ca.length === 0)return combs.push({wcards: [double], map: map});

        let g = _.groupBy(ca, c => {
            return c.substr(0, 1);
        });

        let font = fontThree((g['W'] || []).concat(g['S'] || []), j, map);
        if (font) {
            let three = jackThree(g['D'], font.jacks, map);
            if (three) {
                let t = three.concat(font.three).filter(Boolean);
                (t.length === Math.floor(cards.length / 3)) && t.push(double) && combs.push({wcards: t, map: map});
            }
        }
    });
    return combs.length > 0 && combs;
};

/**
 * kong(杠)
 * @param h     hand cards  (had sort)
 * @param discard
 * @returns {Boolean | Array}
 */
handle.kong = function (h, discard) {
    if (h.length < 3)return false;
    let c = _.without(h, 'A1'), kongCard = [];
    if (discard) {    //if had discard, omit self bright kong
        for (let i = 0; i < c.length - 2; i++) {
            if (discard === c[i] && c[i + 1] === c[i + 2] && c[i] === c[i + 1])return [[discard, discard, discard, discard]];
        }
    } else {
        for (let i = 0; i < c.length - 3; i++) {
            if (c[i] === c[i + 1] && c[i + 2] === c[i + 3] && c[i] === c[i + 2]){
                kongCard.push([c[i], c[i], c[i], c[i]]);
                i += 2;
            }
        }
    }
    return kongCard.length > 0 && kongCard;
};

/**
 * pong(碰)
 * @param hand cards  (had sort)
 * @param discard
 * @returns {Boolean | Array}
 */
handle.pong = function (hCards, discard) {
    let index = hCards.indexOf(discard);
    if (!discard || hCards.length < 2 || index === -1)return false;
    return discard === hCards[index + 1] ? [[discard, discard, discard]] : ~hCards.indexOf('A1') ? [[discard, discard, 'A1']] : false;
};

/**
 * chow(吃)
 * @param hCards
 * @param discard
 * @returns {Boolean | Array}
 */
handle.chow = function (hCards, discard) {
    if(!~discard.indexOf('D'))return false;

    let num = +discard[1], str = discard[0], combs = [];
    let pTwo = str + (num - 2), pOne = str + (num - 1), nOne = str + (num + 1), nTwo = str + (num + 2);
    let jack = ~hCards.indexOf("A1");
    let preTwo = ~hCards.indexOf(pTwo);
    let preOne = ~hCards.indexOf(pOne);
    let nextOne = ~hCards.indexOf(nOne);
    let nextTwo = ~hCards.indexOf(nTwo);

    if(preOne && nextOne){
        preTwo && combs.push([pTwo, pOne, discard]);
        combs.push([pOne, discard, nOne]);
        nextTwo && combs.push([discard, nOne, nTwo]);
    }else if(preOne && !nextOne){
        preTwo && combs.push([pTwo, pOne, discard]) || (jack && combs.push(num === 2 ? [pOne, discard, 'A1'] : ['A1', pOne, discard]));
        nextTwo && jack && combs.push([discard, 'A1', nTwo]);
    }else if(!preOne && nextOne){
        preTwo && jack && combs.push([pTwo, 'A1', discard]);
        nextTwo && combs.push([discard, nOne, nTwo]) || (jack && combs.push(num === 8 ? ['A1', discard, nOne] : [discard, nOne, 'A1']));
    }else if(!preOne && !nextOne){
        preTwo && jack && combs.push([pTwo, 'A1', discard]);
        nextTwo && jack && combs.push([discard, 'A1', nTwo]);
    }
    return combs.length > 0 && combs;
};

module.exports = handle;

//test
if (require.main !== module) return;
let hCards = ['D1','D1','D1','D1', 'D2','D2','D2','D2', 'D3', 'D3', 'D3', 'D4', 'D5', 'D6', 'W1', "S1", "S3", "S2"];
let bCards = [['D2', 'D2', 'D2'], ['W1', 'W1', 'W1']];

//let ac = handle.chow(hCards, 'D8');
//console.log(ac);
// let dw = handle.win(hCards);
let dw = handle.sort(hCards);
console.log(dw);