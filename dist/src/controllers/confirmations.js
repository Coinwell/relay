"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.receiveHeartbeatConfirmation = exports.healthcheck = exports.receiveHeartbeat = exports.tribeOwnerAutoConfirmation = exports.receiveConfirmation = exports.sendConfirmation = void 0;
const lock_1 = require("../utils/lock");
const models_1 = require("../models");
const socket = require("../utils/socket");
const jsonUtils = require("../utils/json");
const network = require("../network");
const constants_1 = require("../constants");
const res_1 = require("../utils/res");
/*
 if in tribe: dont send
 UNLESS tribe admin:
   then send only to the og sender
*/
function sendConfirmation({ chat, sender, msg_id, receiver }) {
    if (!msg_id || !chat || !sender)
        return;
    let theChat = chat;
    const isTribe = chat.type === constants_1.default.chat_types.tribe;
    const isTribeOwner = isTribe && (sender && sender.publicKey) === (chat && chat.ownerPubkey);
    if (isTribe && !isTribeOwner)
        return; // DONT SEND IF NORMAL MEMBER
    if (isTribeOwner && (receiver && receiver.id)) {
        theChat = Object.assign(Object.assign({}, (chat.dataValues || chat)), { contactIds: [receiver.id] });
    }
    network.sendMessage({
        chat: theChat,
        sender,
        message: { id: msg_id },
        type: constants_1.default.message_types.confirmation,
    });
}
exports.sendConfirmation = sendConfirmation;
function receiveConfirmation(payload) {
    return __awaiter(this, void 0, void 0, function* () {
        console.log('=> received confirmation', (payload.message && payload.message.id));
        const dat = payload.content || payload;
        const chat_uuid = dat.chat.uuid;
        const msg_id = dat.message.id;
        const sender_pub_key = dat.sender.pub_key;
        const owner = yield models_1.models.Contact.findOne({ where: { isOwner: true } });
        const sender = yield models_1.models.Contact.findOne({ where: { publicKey: sender_pub_key } });
        const chat = yield models_1.models.Chat.findOne({ where: { uuid: chat_uuid } });
        // new confirmation logic
        if (msg_id) {
            lock_1.default.acquire('confirmation', function (done) {
                return __awaiter(this, void 0, void 0, function* () {
                    // console.log("update status map")
                    const message = yield models_1.models.Message.findOne({ where: { id: msg_id } });
                    if (message) {
                        let statusMap = {};
                        try {
                            statusMap = JSON.parse(message.statusMap || '{}');
                        }
                        catch (e) { }
                        statusMap[sender.id] = constants_1.default.statuses.received;
                        yield message.update({
                            status: constants_1.default.statuses.received,
                            statusMap: JSON.stringify(statusMap)
                        });
                        socket.sendJson({
                            type: 'confirmation',
                            response: jsonUtils.messageToJson(message, chat, sender)
                        });
                    }
                    done();
                });
            });
        }
        else { // old logic
            const messages = yield models_1.models.Message.findAll({
                limit: 1,
                where: {
                    chatId: chat.id,
                    sender: owner.id,
                    type: [
                        constants_1.default.message_types.message,
                        constants_1.default.message_types.invoice,
                        constants_1.default.message_types.attachment,
                    ],
                    status: constants_1.default.statuses.pending,
                },
                order: [['createdAt', 'desc']]
            });
            const message = messages[0];
            message.update({ status: constants_1.default.statuses.received });
            socket.sendJson({
                type: 'confirmation',
                response: jsonUtils.messageToJson(message, chat, sender)
            });
        }
    });
}
exports.receiveConfirmation = receiveConfirmation;
function tribeOwnerAutoConfirmation(msg_id, chat_uuid) {
    return __awaiter(this, void 0, void 0, function* () {
        if (!msg_id || !chat_uuid)
            return;
        const message = yield models_1.models.Message.findOne({ where: { id: msg_id } });
        const chat = yield models_1.models.Chat.findOne({ where: { uuid: chat_uuid } });
        if (message) {
            let statusMap = {};
            try {
                statusMap = JSON.parse(message.statusMap || '{}');
            }
            catch (e) { }
            statusMap['chat'] = constants_1.default.statuses.received;
            yield message.update({
                status: constants_1.default.statuses.received,
                statusMap: JSON.stringify(statusMap)
            });
            socket.sendJson({
                type: 'confirmation',
                response: jsonUtils.messageToJson(message, chat, null)
            });
        }
    });
}
exports.tribeOwnerAutoConfirmation = tribeOwnerAutoConfirmation;
function receiveHeartbeat(payload) {
    return __awaiter(this, void 0, void 0, function* () {
        console.log('=> received heartbeat');
        const dat = payload.content || payload;
        const sender_pub_key = dat.sender.pub_key;
        const receivedAmount = dat.message.amount;
        if (!(sender_pub_key && sender_pub_key.length === 66))
            return console.log('no sender');
        if (!receivedAmount)
            return console.log('no amount');
        const owner = yield models_1.models.Contact.findOne({ where: { isOwner: true } });
        const amount = Math.round(receivedAmount / 2);
        const amt = Math.max(amount || constants_1.default.min_sat_amount);
        const opts = {
            amt,
            dest: sender_pub_key,
            data: {
                type: constants_1.default.message_types.heartbeat_confirmation,
                message: { amount: amt },
                sender: { pub_key: owner.publicKey }
            }
        };
        try {
            yield network.signAndSend(opts);
            return true;
        }
        catch (e) {
            return false;
        }
    });
}
exports.receiveHeartbeat = receiveHeartbeat;
let heartbeats = {};
function healthcheck(req, res) {
    return __awaiter(this, void 0, void 0, function* () {
        const pubkey = req.query.pubkey;
        if (!(pubkey && pubkey.length === 66)) {
            return res_1.failure200(res, 'missing pubkey');
        }
        const owner = yield models_1.models.Contact.findOne({ where: { isOwner: true } });
        const amt = 10;
        const opts = {
            amt,
            dest: pubkey,
            data: {
                type: constants_1.default.message_types.heartbeat,
                message: {
                    amount: amt,
                },
                sender: { pub_key: owner.publicKey }
            }
        };
        try {
            yield network.signAndSend(opts);
        }
        catch (e) {
            res_1.failure200(res, e);
            return;
        }
        let i = 0;
        let interval = setInterval(() => {
            if (i >= 15) {
                clearInterval(interval);
                delete heartbeats[pubkey];
                res_1.failure200(res, 'no confimration received');
                return;
            }
            if (heartbeats[pubkey]) {
                res_1.success(res, 'success');
                clearInterval(interval);
                delete heartbeats[pubkey];
                return;
            }
            i++;
        }, 1000);
    });
}
exports.healthcheck = healthcheck;
function receiveHeartbeatConfirmation(payload) {
    return __awaiter(this, void 0, void 0, function* () {
        console.log('=> received heartbeat confirmation');
        const dat = payload.content || payload;
        const sender_pub_key = dat.sender.pub_key;
        heartbeats[sender_pub_key] = true;
    });
}
exports.receiveHeartbeatConfirmation = receiveHeartbeatConfirmation;
//# sourceMappingURL=confirmations.js.map