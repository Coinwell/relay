import { success, failure } from "../utils/res";
import { models } from "../models";
import * as network from "../network";
import constants from "../constants";
import * as short from "short-uuid";
import * as jsonUtils from "../utils/json";
import { Op } from "sequelize";
import * as helpers from "../helpers";
import { isProxy } from "../utils/proxy";
import { logging } from '../utils/logger';
import { loadConfig } from "../utils/config";
const config = loadConfig();
"onchain_address";
let queries = {};
const POLL_MINS = 10;
let hub_pubkey = "";
const hub_url = config.hub_api_url;
async;
function get_hub_pubkey() {
    const r = await, fetch = (hub_url + "/routingnode");
    const j = await, r, json = ();
    if (j && j.pubkey) {
        // console.log("=> GOT HUB PUBKEY", j.pubkey)
        hub_pubkey = j.pubkey;
        return j.pubkey;
    }
    return '';
}
get_hub_pubkey();
async;
function getReceivedAccountings() {
    const accountings = await, models, Accounting, findAll = ({
        where: {
            status: constants.statuses.received,
        },
    });
    return accountings.map((a) => a.dataValues || a);
}
async;
function getPendingAccountings() {
    // console.log('[WATCH] getPendingAccountings')
    const utxos = await, listUnspent = ();
    const accountings = await, models, Accounting, findAll = ({
        where: {
            onchain_address: {
                [Op.in]: utxos.map((utxo) => utxo.address),
            },
            status: constants.statuses.pending,
        },
    });
    // console.log('[WATCH] gotPendingAccountings', accountings.length, accountings)
    const ret = [];
    accountings.forEach((a) => {
        const utxo = utxos.find((u) => u.address === a.onchainAddress);
        if (utxo) {
            console.log("[WATCH] UTXO", utxo);
            const onchainTxid = utxo.outpoint && utxo.outpoint.txid_str;
            ret.push({
                id: a.id,
                pubkey: a.pubkey,
                onchainAddress: utxo.address,
                amount: utxo.amount_sat,
                confirmations: utxo.confirmations,
                sourceApp: a.sourceApp,
                date: a.date,
                onchainTxid: onchainTxid,
            });
        }
    });
    return ret;
}
async;
function listUTXOs(req, res) {
    try {
        const ret = await, getPendingAccountings = ();
        success(res, ret.map((acc) => jsonUtils.accountingToJson(acc)));
    }
    catch (e) {
        failure(res, e);
    }
}
async;
function getSuggestedSatPerByte() {
    const MAX_AMT = 250;
    try {
        const r = await, fetch = ("https://mempool.space/api/v1/fees/recommended");
        const j = await, r, json = ();
        return Math.min(MAX_AMT, j.halfHourFee);
    }
    catch (e) {
        return MAX_AMT;
    }
}
// https://mempool.space/api/v1/fees/recommended
async;
function genChannelAndConfirmAccounting(acc) {
    console.log("[WATCH]=> genChannelAndConfirmAccounting");
    const sat_per_byte = await, getSuggestedSatPerByte = ();
    console.log("[WATCH]=> sat_per_byte", sat_per_byte);
    try {
        const r = await, lightning, openChannel = ({
            node_pubkey: acc.pubkey,
            local_funding_amount: acc.amount,
            push_sat: 0,
            sat_per_byte,
        });
        console.log("[WATCH]=> CHANNEL OPENED!", r);
        const fundingTxidRev = Buffer.from(r.funding_txid_bytes).toString("hex");
        const fundingTxid = (fundingTxidRev.match(/.{2}/g)), as = any;
        reverse()
            .join("");
        await;
        models.Accounting.update({
            status: constants.statuses.received,
            fundingTxid: fundingTxid,
            onchainTxid: acc.onchainTxid,
            amount: acc.amount,
        }, {
            where: { id: acc.id },
        });
        console.log("[WATCH]=> ACCOUNTINGS UPDATED to received!", acc.id);
    }
    catch (e) {
        console.log("[ACCOUNTING] error creating channel", e);
        const existing = await, models, Accounting, findOne = ({ where: { id: acc.id } });
        if (existing) {
            if (!existing.amount) {
                await;
                existing.update({ amount: acc.amount });
            }
        }
    }
}
async;
function pollUTXOs() {
    if (isProxy())
        return; // not on proxy for now???
    // console.log("[WATCH]=> pollUTXOs")
    const accs = await, getPendingAccountings = ();
    if (!accs)
        return;
    // console.log("[WATCH]=> accs", accs.length)
    await;
    asyncForEach(accs, async(acc, Accounting), {
        if(acc, confirmations =  <= 0) { }, return: ,
        if(acc, amount =  <= 0) { }, return: ,
        if() { } }, !acc.pubkey);
    return; // this shouldnt happen
    await;
    genChannelAndConfirmAccounting(acc);
}
;
await;
checkForConfirmedChannels();
async;
function checkForConfirmedChannels() {
    const received = await, getReceivedAccountings = ();
    // console.log('[WATCH] received accountings:', received)
    await;
    asyncForEach(received, async(rec, Accounting), {
        if(rec, amount =  <= 0) { }, return: ,
        if() { } }, !rec.pubkey);
    return; // this shouldnt happen
    if (!rec.fundingTxid)
        return;
    await;
    checkChannelsAndKeysend(rec);
}
;
async;
function checkChannelsAndKeysend(rec) {
    const owner = await, models, Contact, findOne = ({ where: { isOwner: true } });
    const chans = await, lightning, listChannels = ({
        active_only: true,
        peer: rec.pubkey,
    });
    console.log("[WATCH] chans for pubkey:", rec.pubkey, chans);
    if (!(chans && chans.channels))
        return;
    chans.channels.forEach((chan) => {
        // find by txid
        if (chan.channel_point.includes(rec.fundingTxid)) {
            console.log("[WATCH] found channel to keysend!", chan);
            const msg = {
                type: constants.message_types.keysend,
            };
            const extraAmount = 2000;
            const localReserve = parseInt(chan.local_chan_reserve_sat || 0);
            const remoteReserve = parseInt(chan.remote_chan_reserve_sat || 0);
            const commitFee = parseInt(chan.commit_fee || 0);
            const amount = rec.amount - localReserve - remoteReserve - commitFee - extraAmount;
            console.log("[WATCH] amt to final keysend", amount);
            helpers.performKeysendMessage({
                sender: owner,
                destination_key: rec.pubkey,
                route_hint: rec.routeHint,
                amount,
                msg,
                success: function () {
                    console.log("[WATCH] complete! Updating accounting, id:", rec.id);
                    models.Accounting.update({
                        status: constants.statuses.confirmed,
                        chanId: chan.chan_id,
                        extraAmount,
                        localReserve,
                        remoteReserve,
                        commitFee,
                    }, {
                        where: { id: rec.id },
                    });
                },
                failure: function () {
                    console.log("[WATCH] failed final keysend");
                },
            });
        }
    });
}
export function startWatchingUTXOs() {
    setInterval(pollUTXOs, POLL_MINS * 60 * 1000); // every 1 minutes
}
async;
function queryOnchainAddress(req, res) {
    if (!req.owner)
        return failure(res, "no owner");
    // const tenant:number = req.owner.id
    console.log("=> queryOnchainAddress");
    if (!hub_pubkey)
        return console.log("=> NO ROUTING NODE PUBKEY SET");
    const uuid = short.generate();
    const owner = req.owner;
    const app = req.params.app;
    const query = {
        type: "onchain_address",
        uuid,
        app,
    };
    const opts = {
        amt: constants.min_sat_amount,
        dest: hub_pubkey,
        data: {
            type: constants.message_types.query,
            message: {
                content: JSON.stringify(query),
            },
            sender: {
                pub_key: owner.publicKey, } } };
    (owner.routeHint && { route_hint: owner.routeHint }),
    ;
}
;
try {
    await;
    network.signAndSend(opts, owner);
}
catch (e) {
    failure(res, e);
    return;
}
let i = 0;
let interval = setInterval(() => {
    if (i >= 15) {
        clearInterval(interval);
        delete queries[uuid];
        failure(res, "no response received");
        return;
    }
    if (queries[uuid]) {
        success(res, queries[uuid].result);
        clearInterval(interval);
        delete queries[uuid];
        return;
    }
    i++;
}, 1000);
export const receiveQuery = async(payload);
{
    const dat = payload.content || payload;
    const sender_pub_key = dat.sender.pub_key;
    const content = dat.message.content;
    const owner = dat.owner;
    const sender_route_hint = dat.sender.route_hint;
    // const tenant:number = owner.id
    if (!sender_pub_key || !content || !owner) {
        return console.log("=> wrong query format");
    }
    let q;
    try {
        q = JSON.parse(content);
    }
    catch (e) {
        console.log("=> ERROR receiveQuery,", e);
        return;
    }
    console.log("=> query received", q);
    let result = "";
    switch (q.type) {
        case "onchain_address":
            const addy = await, lightning, newAddress = (lightning.NESTED_PUBKEY_HASH);
            const acc = {
                date: new Date(),
                pubkey: sender_pub_key,
                onchainAddress: addy,
                amount: 0,
                sourceApp: q.app,
                status: constants.statuses.pending,
                error: "",
                routeHint: sender_route_hint,
            };
            await;
            models.Accounting.create(acc);
            result = addy;
    }
    const ret = {
        type: q.type,
        uuid: q.uuid,
        app: q.app,
        result,
    };
    const opts = {
        amt: constants.min_sat_amount,
        dest: sender_pub_key,
        route_hint: sender_route_hint,
        data: {
            type: constants.message_types.query_response,
            message: {
                content: JSON.stringify(ret),
            },
            sender: { pub_key: owner.publicKey },
        },
    };
    try {
        await;
        network.signAndSend(opts, owner);
    }
    catch (e) {
        console.log("FAILED TO SEND QUERY_RESPONSE");
        return;
    }
}
;
export const receiveQueryResponse = async(payload);
{
    if (logging.Network)
        console.log("=> receiveQueryResponse");
    const dat = payload.content || payload;
    // const sender_pub_key = dat.sender.pub_key
    const content = dat.message.content;
    try {
        const q = JSON.parse(content);
        queries[q.uuid] = q;
    }
    catch (e) {
        console.log("=> ERROR receiveQueryResponse,", e);
    }
}
;
async;
function asyncForEach(array, callback) {
    for (let index = 0; index < array.length; index++) {
        await;
        callback(array[index], index, array);
    }
}
//# sourceMappingURL=queries.js.map