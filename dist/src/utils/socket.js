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
exports.sendJson = exports.send = exports.connect = void 0;
const models_1 = require("../models");
const crypto = require("crypto");
// import * as WebSocket from 'ws'
const socketio = require("socket.io");
let io;
// let srvr: any
function connect(server) {
    // srvr = new WebSocket.Server({ server, clientTracking:true })
    io = socketio(server, {
        handlePreflightRequest: (req, res) => {
            const headers = {
                "Access-Control-Allow-Headers": "Content-Type, Accept, x-user-token, X-Requested-With",
                "Access-Control-Allow-Origin": req.headers.origin,
                "Access-Control-Allow-Credentials": true
            };
            res.writeHead(200, headers);
            res.end();
        }
    });
    io.use((socket, next) => __awaiter(this, void 0, void 0, function* () {
        let userToken = socket.handshake.headers['x-user-token'];
        const isValid = yield isValidToken(userToken);
        if (isValid) {
            return next();
        }
        return next(new Error('authentication error'));
    }));
    io.on('connection', client => {
        console.log("=> [socket.io] connected!");
    });
}
exports.connect = connect;
function isValidToken(token) {
    return __awaiter(this, void 0, void 0, function* () {
        if (!token)
            return false;
        const user = yield models_1.models.Contact.findOne({ where: { isOwner: true } });
        const hashedToken = crypto.createHash('sha256').update(token).digest('base64');
        if (user.authToken == null || user.authToken != hashedToken) {
            return false; // failed
        }
        return true;
    });
}
const send = (body) => {
    if (io)
        io.sockets.emit('message', body);
    // if(srvr){
    //   srvr.clients.forEach(c=>{
    //     if(c) c.send(body)
    //   })
    // }
};
exports.send = send;
const sendJson = (object) => {
    exports.send(JSON.stringify(object));
};
exports.sendJson = sendJson;
//# sourceMappingURL=socket.js.map