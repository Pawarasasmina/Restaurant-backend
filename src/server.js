import http from 'node:http';
import mongoose from 'mongoose';
import { Server } from 'socket.io';
import { env } from './config/env.js';
import { createApp } from './app.js';
import { configureSockets } from './sockets/index.js';
await mongoose.connect(env.MONGODB_URI);
const app=createApp();
const server=http.createServer(app);
const io=new Server(server,{cors:{origin:env.FRONTEND_URL,credentials:true}});
app.set('io',io);
configureSockets(io);
server.listen(env.PORT,()=>console.log(`API listening on http://localhost:${env.PORT}`));
const shutdown=async()=>{io.close();server.close();await mongoose.disconnect();process.exit(0);};process.on('SIGINT',shutdown);process.on('SIGTERM',shutdown);

