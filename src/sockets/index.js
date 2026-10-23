import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';
import { TableSession, User } from '../models/index.js';

const parseCookies = raw => Object.fromEntries((raw || '').split(';').map(v=>v.trim().split('=').map(decodeURIComponent)).filter(x=>x.length===2));
export const configureSockets = io => {
  io.use(async (socket,next)=>{try{const cookies=parseCookies(socket.handshake.headers.cookie);if(cookies.accessToken){const p=jwt.verify(cookies.accessToken,env.JWT_SECRET);const user=await User.findById(p.sub);if(!user?.active)throw new Error();socket.data.user=user;}else if(cookies.tableSession){const session=await TableSession.findOne({tokenHash:cookies.tableSession,status:'active',expiresAt:{$gt:new Date()}});if(!session)throw new Error();socket.data.tableSession=session;}else throw new Error();next();}catch{next(new Error('unauthorized'));}});
  io.on('connection',socket=>{if(socket.data.user){socket.join(`staff:${socket.data.user.role}`);socket.join('staff:orders');if(['owner','manager','waiter','cashier'].includes(socket.data.user.role))socket.join('staff:calls');}if(socket.data.tableSession)socket.join(`table:${socket.data.tableSession.id}`);socket.emit('connected',{refetch:true});});
};

